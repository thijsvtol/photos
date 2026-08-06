import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for GET /api/people/named's access-control filter (routes/public.ts) — this endpoint is
 * intentionally public/unauthenticated (unlike /admin/people), but must never leak the mere
 * existence/name of a person who only appears in a private or collaborators_only event the
 * requester has no access to. Admins always see everyone (same as every other visibility check
 * in this app); anonymous/regular users only see people who appear in a public event, or a
 * collaborators_only event they're specifically a collaborator on.
 */

let mockUser: { email: string } | null = null;
let mockIsAdmin = false;

vi.mock('../auth', () => ({
  optionalAuth: async (c: any, next: any) => {
    await next();
  },
  getUser: () => mockUser,
  isAdmin: () => mockIsAdmin,
  getCollaboratorRoleByEventId: async () => null,
  hasEventSessionAccess: async () => true,
}));

vi.mock('../aiEnrichment', () => ({
  embedSearchQuery: async () => null,
  cosineSimilarity: () => 0,
}));

import publicRoutes from '../routes/public';

interface FakePerson {
  id: number;
  name: string;
  eventVisibility: 'public' | 'private' | 'collaborators_only';
  collaboratorEmails: string[];
}

function makeEnv(people: FakePerson[]) {
  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async all() {
          if (query.includes('FROM person_clusters pc') && query.includes('EXISTS')) {
            const [isAdminArg, userEmail] = boundArgs as [number, string];
            const results = people
              .filter((p) => {
                if (isAdminArg === 1) return true;
                if (p.eventVisibility === 'public') return true;
                if (p.eventVisibility === 'collaborators_only') return p.collaboratorEmails.includes(userEmail);
                return false;
              })
              .map((p) => ({ id: p.id, name: p.name }));
            return { results };
          }
          return { results: [] };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  };

  return { DB: db } as any;
}

describe('GET /api/people/named access control', () => {
  it('anonymous visitor only sees people from public events', async () => {
    mockUser = null;
    mockIsAdmin = false;
    const env = makeEnv([
      { id: 1, name: 'Public Person', eventVisibility: 'public', collaboratorEmails: [] },
      { id: 2, name: 'Private Person', eventVisibility: 'private', collaboratorEmails: [] },
      { id: 3, name: 'Collab Person', eventVisibility: 'collaborators_only', collaboratorEmails: ['someone@example.com'] },
    ]);

    const res = await publicRoutes.fetch(new Request('http://test/api/people/named'), env);
    const body = await res.json() as { people: { id: number; name: string }[] };

    expect(body.people.map((p) => p.name)).toEqual(['Public Person']);
  });

  it('collaborator sees people from public events and events they collaborate on', async () => {
    mockUser = { email: 'me@example.com' };
    mockIsAdmin = false;
    const env = makeEnv([
      { id: 1, name: 'Public Person', eventVisibility: 'public', collaboratorEmails: [] },
      { id: 2, name: 'Private Person', eventVisibility: 'private', collaboratorEmails: [] },
      { id: 3, name: 'My Collab Person', eventVisibility: 'collaborators_only', collaboratorEmails: ['me@example.com'] },
      { id: 4, name: 'Other Collab Person', eventVisibility: 'collaborators_only', collaboratorEmails: ['someone-else@example.com'] },
    ]);

    const res = await publicRoutes.fetch(new Request('http://test/api/people/named'), env);
    const body = await res.json() as { people: { id: number; name: string }[] };

    expect(body.people.map((p) => p.name).sort()).toEqual(['My Collab Person', 'Public Person']);
  });

  it('admin sees every named person regardless of event visibility', async () => {
    mockUser = { email: 'admin@example.com' };
    mockIsAdmin = true;
    const env = makeEnv([
      { id: 1, name: 'Public Person', eventVisibility: 'public', collaboratorEmails: [] },
      { id: 2, name: 'Private Person', eventVisibility: 'private', collaboratorEmails: [] },
      { id: 3, name: 'Collab Person', eventVisibility: 'collaborators_only', collaboratorEmails: ['someone@example.com'] },
    ]);

    const res = await publicRoutes.fetch(new Request('http://test/api/people/named'), env);
    const body = await res.json() as { people: { id: number; name: string }[] };

    expect(body.people.map((p) => p.name).sort()).toEqual(['Collab Person', 'Private Person', 'Public Person']);
  });
});
