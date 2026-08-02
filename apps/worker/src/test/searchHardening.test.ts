import { describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for GET /api/search's security/cost hardening
 * (routes/public.ts), added after a review found two real issues:
 *
 * 1. The semantic re-rank step called Workers AI's embedSearchQuery() on
 *    EVERY multi-word query, even when the FTS pre-filter produced zero
 *    candidates — since this endpoint is public/unauthenticated, that let
 *    an attacker burn through the free 10,000-neurons/day Workers AI
 *    allocation with garbage queries. Fixed: only call embedSearchQuery when
 *    there's at least one FTS candidate to actually re-rank.
 * 2. The FTS5 MATCH query string was built by stripping only `"`/`*` from
 *    user input, but a bound parameter to MATCH is still parsed as an FTS5
 *    query EXPRESSION (not a literal string) by SQLite — so unescaped
 *    boolean keywords (AND/OR/NOT), column filters ("col:term"), or
 *    parentheses in the search box could throw a syntax error or search
 *    unintended columns. Fixed: every term is wrapped in double quotes
 *    (embedded quotes stripped) so it's always treated as a literal
 *    phrase/prefix token, never as FTS5 operator syntax.
 */

const embedSearchQueryMock = vi.fn();

vi.mock('../auth', () => ({
  optionalAuth: async (c: any, next: any) => {
    await next();
  },
  getUser: () => null,
  isAdmin: () => false,
  getCollaboratorRoleByEventId: async () => null,
}));

vi.mock('../aiEnrichment', () => ({
  embedSearchQuery: (...args: unknown[]) => embedSearchQueryMock(...args),
  cosineSimilarity: () => 0,
}));

import publicRoutes from '../routes/public';

const events = [{ id: 1, slug: 'evt', name: 'Event', visibility: 'public', password_hash: null }];

/** Captures the exact FTS5 MATCH query string bound for inspection. */
function makeEnv(candidatePhotos: Array<{ id: string; embedding: ArrayBuffer | null }>) {
  let lastFtsQuery: string | null = null;

  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async all() {
          if (query.includes('FROM events e') && query.includes('LEFT JOIN event_collaborators')) {
            return { results: events };
          }
          if (query.includes('photos_fts MATCH ?')) {
            lastFtsQuery = String(boundArgs[0]);
            return {
              results: candidatePhotos.map((p) => ({
                id: p.id,
                event_id: 1,
                original_filename: `${p.id}.jpg`,
                file_type: 'image/jpeg',
                capture_time: '2024-01-01T00:00:00Z',
                width: 100,
                height: 100,
                blur_placeholder: null,
                cache_version: 1,
                ai_caption: null,
                embedding: p.embedding,
              })),
            };
          }
          return { results: [] };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
  };

  return { env: { DB: db as unknown as D1Database } as any, getLastFtsQuery: () => lastFtsQuery };
}

describe('GET /api/search hardening', () => {
  it('does NOT call embedSearchQuery when the FTS pre-filter has zero candidates', async () => {
    embedSearchQueryMock.mockClear();
    const { env } = makeEnv([]);

    const res = await publicRoutes.request('http://localhost/api/search?q=some+random+gibberish', {}, env);

    expect(res.status).toBe(200);
    expect(embedSearchQueryMock).not.toHaveBeenCalled();
  });

  it('DOES call embedSearchQuery for a multi-word query with at least one FTS candidate', async () => {
    embedSearchQueryMock.mockClear();
    embedSearchQueryMock.mockResolvedValue(null);
    const { env } = makeEnv([{ id: 'photo-1', embedding: null }]);

    const res = await publicRoutes.request('http://localhost/api/search?q=birthday+party', {}, env);

    expect(res.status).toBe(200);
    expect(embedSearchQueryMock).toHaveBeenCalledWith(expect.anything(), 'birthday party');
  });

  it('never calls embedSearchQuery for a single-word query (FTS alone is sufficient)', async () => {
    embedSearchQueryMock.mockClear();
    const { env } = makeEnv([{ id: 'photo-1', embedding: null }]);

    await publicRoutes.request('http://localhost/api/search?q=birthday', {}, env);

    expect(embedSearchQueryMock).not.toHaveBeenCalled();
  });

  it('wraps every search term in double quotes so FTS5 boolean/column-filter syntax cannot be injected', async () => {
    const { env, getLastFtsQuery } = makeEnv([]);

    // "OR", "NOT", and a column-filter-looking token are all things that
    // have special meaning to FTS5's query parser if left unquoted.
    await publicRoutes.request('http://localhost/api/search?q=' + encodeURIComponent('OR ai_caption:secret NOT'), {}, env);

    const ftsQuery = getLastFtsQuery();
    expect(ftsQuery).not.toBeNull();
    // Every term must be fully quoted (with a trailing prefix '*' outside
    // the closing quote, per FTS5's documented prefix-query syntax) — no
    // bare "OR"/"NOT" keywords or unquoted colons should reach the parser.
    expect(ftsQuery).toBe('"OR"* "ai_caption:secret"* "NOT"*');
  });

  it('strips embedded double-quote characters from terms before quoting them', async () => {
    const { env, getLastFtsQuery } = makeEnv([]);

    await publicRoutes.request('http://localhost/api/search?q=' + encodeURIComponent('a"b"c'), {}, env);

    expect(getLastFtsQuery()).toBe('"abc"*');
  });

  it('never leaks the raw embedding BLOB back to the client', async () => {
    const { env } = makeEnv([{ id: 'photo-1', embedding: new Float32Array([1, 2, 3]).buffer }]);

    const res = await publicRoutes.request('http://localhost/api/search?q=beach', {}, env);
    const body = (await res.json()) as { photos: Array<Record<string, unknown>> };

    expect(body.photos).toHaveLength(1);
    expect(body.photos[0]).not.toHaveProperty('embedding');
  });
});
