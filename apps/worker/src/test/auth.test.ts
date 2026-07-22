import { describe, it, expect } from 'vitest';
import { getCollaboratorRole, getCollaboratorRoleByEventId, hasEventCapability } from '../auth';

/**
 * Minimal fake D1Database that actually evaluates the WHERE clauses used by
 * getCollaboratorRole()/getCollaboratorRoleByEventId(), so these tests catch
 * real case-sensitivity regressions instead of relying on string-matching
 * mocks. Only supports the exact query shapes those two functions issue.
 */
function createFakeDb(rows: Array<{ event_id: number; slug: string; user_email: string; role: string }>) {
  return {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundArgs = args;
          return this;
        },
        async first<T>() {
          if (query.includes('JOIN events e')) {
            const [slug, userEmail] = boundArgs as [string, string];
            const match = rows.find(
              r => r.slug === slug && r.user_email.toLowerCase() === String(userEmail).toLowerCase()
            );
            return (match ? { role: match.role } : null) as T | null;
          }

          // getCollaboratorRoleByEventId: WHERE event_id = ? AND ...user_email = ?
          const [eventId, userEmail] = boundArgs as [number, string];
          const match = rows.find(
            r => r.event_id === eventId && r.user_email.toLowerCase() === String(userEmail).toLowerCase()
          );
          return (match ? { role: match.role } : null) as T | null;
        },
      };
    },
  } as any;
}

describe('getCollaboratorRole (case-insensitive email matching)', () => {
  const rows = [
    { event_id: 1, slug: 'summer-party', user_email: 'Jane.Doe@Example.com', role: 'uploader' },
  ];

  it('matches when the login email casing differs from the stored casing', async () => {
    const db = createFakeDb(rows);
    const role = await getCollaboratorRole(db, 'summer-party', 'jane.doe@example.com');
    expect(role).toBe('uploader');
  });

  it('matches the same way for getCollaboratorRoleByEventId', async () => {
    const db = createFakeDb(rows);
    const role = await getCollaboratorRoleByEventId(db, 1, 'JANE.DOE@EXAMPLE.COM');
    expect(role).toBe('uploader');
  });

  it('grants the upload capability regardless of email casing', async () => {
    const db = createFakeDb(rows);
    const allowed = await hasEventCapability(db, 'summer-party', 'jane.DOE@example.COM', 'upload');
    expect(allowed).toBe(true);
  });

  it('returns null for an email that truly does not match', async () => {
    const db = createFakeDb(rows);
    const role = await getCollaboratorRole(db, 'summer-party', 'someone-else@example.com');
    expect(role).toBeNull();
  });
});
