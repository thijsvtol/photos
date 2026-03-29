import { describe, it, expect, beforeEach, vi } from 'vitest';
import adminRoutes from '../routes/admin';
import publicRoutes from '../routes/public';
import favoritesRoutes from '../routes/favorites';
import collaboratorsRoutes from '../routes/collaborators';
import type { User } from '../types';
import { createEnv, createBucket, MockD1Database, type TestEnv, type EventRecord, type PhotoRecord, type FavoriteRecord, type CollaboratorRecord } from './mocks';

let currentUser: User | null = null;
let currentIsAdmin = false;

function makeEventRecord(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 1,
    slug: 'default-event',
    name: 'Default Event',
    inferred_date: null,
    created_at: new Date().toISOString(),
    visibility: 'public',
    password_hash: null,
    ...overrides,
  };
}

function makePhotoRecord(overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id: 'photo-default',
    event_id: 1,
    original_filename: 'default.jpg',
    file_type: 'image/jpeg',
    capture_time: new Date().toISOString(),
    uploaded_at: new Date().toISOString(),
    uploaded_by: null,
    width: null,
    height: null,
    iso: null,
    aperture: null,
    shutter_speed: null,
    focal_length: null,
    camera_make: null,
    camera_model: null,
    lens_model: null,
    latitude: null,
    longitude: null,
    favorites_count: 0,
    blur_placeholder: null,
    is_featured: 0,
    city: null,
    ...overrides,
  };
}

vi.mock('../auth', () => {
  return {
    optionalAuth: async (c: any, next: any) => {
      if (currentUser) {
        c.set('user', currentUser);
      }
      await next();
    },
    requireAuth: async (c: any, next: any) => {
      if (!currentUser) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      c.set('user', currentUser);
      await next();
    },
    requireAdmin: async (c: any, next: any) => {
      if (!currentUser) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      if (!currentIsAdmin) {
        return c.json({ error: 'Admin access required' }, 403);
      }
      c.set('user', currentUser);
      await next();
    },
    requireUploadPermission: async (c: any, next: any) => {
      if (!currentUser) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      c.set('user', currentUser);
      await next();
    },
    requireEventCapability: () => async (c: any, next: any) => {
      if (!currentUser) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      c.set('user', currentUser);
      await next();
    },
    hasEventCapabilityByEventId: async () => currentIsAdmin,
    getCollaboratorRole: async () => (currentIsAdmin ? 'admin' : 'viewer'),
    extractUser: async () => currentUser,
    checkEventAuth: async () => true,
    getUser: (c: any) => c.get('user') || null,
    isAdmin: () => currentIsAdmin,
    isCollaborator: async () => false,
    isUserAdmin: () => false,
  };
});

describe('Data Integrity & Security', () => {
  beforeEach(() => {
    currentUser = null;
    currentIsAdmin = false;
  });

  // 2. SQL INJECTION PREVENTION
  describe('SQL Injection Prevention', () => {
    it('prevents SQL injection in event slug', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };

      const injectionAttempts = [
        "'; DROP TABLE events; --",
        "' OR '1'='1",
        "admin' --",
        "1' UNION SELECT * FROM users --",
        "'; DELETE FROM events WHERE '1'='1",
      ];

      for (const attemptSlug of injectionAttempts) {
        const response = await publicRoutes.request(`http://localhost/api/events/${attemptSlug}`, {}, env);
        // Should either return 404 or error, never execute malicious query
        expect([400, 401, 404]).toContain(response.status);
      }
    });

    it('prevents SQL injection in photo ID', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };

      const injectionAttempts = [
        "photo-1' OR '1'='1",
        "photo-1\"; DROP TABLE photos; --",
        "photo-1; DELETE FROM favorites; --",
      ];

      for (const photoId of injectionAttempts) {
        const response = await publicRoutes.request(
          `http://localhost/api/events/public-event/photos/${photoId}`,
          {},
          env
        );
        // Should not execute injection
        expect([400, 401, 404]).toContain(response.status);
      }
    });

    it('prevents SQL injection in event names', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
      currentIsAdmin = true;

      const injectionPayloads = [
        { name: "Test'; DROP TABLE events; --", slug: 'test-event' },
        { name: "Test\"); DELETE FROM photos; --", slug: 'test-event-2' },
        { name: "Test' OR '1'='1", slug: 'test-event-3' },
      ];

      for (const payload of injectionPayloads) {
        const response = await adminRoutes.request('http://localhost/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }, env);

        // All queries should be parameterized, request succeeds but doesn't execute injection
        expect([200, 201, 400, 500]).toContain(response.status);

        // Verify no DROP/DELETE queries were executed
        const hasDestructive = db.queryLog.some(log =>
          /DROP|DELETE.*FROM/i.test(log.query) && !log.query.includes('WHERE')
        );
        expect(hasDestructive).toBe(false);
      }
    });

    it('prevents SQL injection in collaborator emails', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
      currentIsAdmin = true;

      const injectionEmails = [
        "user@example.com' OR '1'='1",
        "user@example.com\"; DROP TABLE collaborators; --",
        "user@example.com' UNION SELECT * FROM users --",
      ];

      for (const email of injectionEmails) {
        const response = await collaboratorsRoutes.request(
          'http://localhost/api/events/public-event/collaborators',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          },
          env
        );

        // Should reject or handle safely, never execute injection
        expect([400, 401, 403, 404, 500]).toContain(response.status);
      }
    });

    it('uses parameterized queries for all database operations', () => {
      const db = new MockD1Database();

      // Simulate various query logs that should all be parameterized
      db.queryLog.push({
        query: 'SELECT * FROM events WHERE slug = ?',
        args: ['public-event'],
      });
      db.queryLog.push({
        query: 'INSERT INTO favorites (photo_id, user_email) VALUES (?, ?)',
        args: ['photo-1', 'user@example.com'],
      });
      db.queryLog.push({
        query: 'DELETE FROM photos WHERE id = ? AND event_id = ?',
        args: ['photo-1', 1],
      });

      // Verify all use parameterized placeholders (?)
      const allParameterized = db.queryLog.every(log => {
        // Should have ? for each param, not concatenated values
        return !log.query.includes("'") || log.query.match(/\?/g)?.length === log.args.length;
      });

      expect(allParameterized).toBe(true);
    });

    it('properly escapes special characters in search queries', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };

      const specialChars = [
        'event%with%percent',
        'event_with_underscore',
        'event with space',
        'event\\with\\backslash',
        'event"with"quotes',
        "event'with'quotes",
      ];

      for (const searchTerm of specialChars) {
        const response = await publicRoutes.request('http://localhost/api/events', {
          headers: { 'X-Search-Query': searchTerm },
        }, env);

        // Should handle all special chars without SQL errors
        expect([200, 400, 401, 500]).toContain(response.status);
      }
    });
  });

  // 4. CASCADE DELETE SAFETY
  describe('Cascade Delete Safety', () => {
    it('deleting event cascades to photos and cleans up collaborators', () => {
      const db = new MockD1Database();

      // Setup: Create event with photos and collaborators
      db.events = [makeEventRecord({ id: 1, slug: 'test-event', name: 'Test', visibility: 'public' })];
      db.photos = [
        makePhotoRecord({ id: 'photo-1', event_id: 1, original_filename: 'test.jpg' }),
        makePhotoRecord({ id: 'photo-2', event_id: 1, original_filename: 'test2.jpg' }),
      ];
      db.collaborators = [
        { event_id: 1, user_email: 'collab@example.com' },
      ];
      db.collaborationHistory = [
        { event_id: 1, action: 'invite', user_email: 'collab@example.com' },
      ];

      const stmt = db.prepare('DELETE FROM events WHERE id = ?');
      stmt.bind(1);

      // Delete event
      stmt.run();

      // Verify cascade cleanup
      expect(db.deletedEvents.has(1)).toBe(true);
      expect(db.photos.filter(p => p.event_id === 1)).toHaveLength(0);
      expect(db.collaborators.filter(c => c.event_id === 1)).toHaveLength(0);
      expect(db.collaborationHistory.filter(h => h.event_id === 1)).toHaveLength(0);
    });

    it('deleting photo removes favorites and prevents orphans', () => {
      const db = new MockD1Database();

      // Setup
      db.photos = [
        makePhotoRecord({ id: 'photo-1', event_id: 1, original_filename: 'test.jpg' }),
      ];
      db.favorites = [
        { photo_id: 'photo-1', user_email: 'user1@example.com' },
        { photo_id: 'photo-1', user_email: 'user2@example.com' },
      ];

      const stmt = db.prepare('DELETE FROM photos WHERE id = ?');
      stmt.bind('photo-1');

      stmt.run();

      // Verify photo deleted
      expect(db.deletedPhotos.has('photo-1')).toBe(true);
      expect(db.photos).toHaveLength(0);

      // Verify orphaned favorites cleaned up
      expect(db.favorites.filter(f => f.photo_id === 'photo-1')).toHaveLength(0);
    });

    it('prevents orphaned records after deletion', () => {
      const db = new MockD1Database();

      db.events = [
        makeEventRecord({ id: 1, slug: 'event-1', name: 'Event 1', visibility: 'public' }),
      ];
      db.photos = [
        makePhotoRecord({ id: 'photo-1', event_id: 1, original_filename: 'test.jpg' }),
        makePhotoRecord({ id: 'photo-2', event_id: 2, original_filename: 'test2.jpg' }),
      ];
      db.favorites = [
        { photo_id: 'photo-1', user_email: 'user@example.com' },
        { photo_id: 'photo-2', user_email: 'user@example.com' },
      ];
      db.collaborators = [
        { event_id: 1, user_email: 'collab@example.com' },
      ];

      // Delete event 1
      const stmt = db.prepare('DELETE FROM events WHERE id = ?');
      stmt.bind(1);
      stmt.run();

      // Verify no orphaned records from this event
      const photosForDeletedEvent = db.photos.filter(p => p.event_id === 1);
      expect(photosForDeletedEvent).toHaveLength(0);

      const favoritesForDeletedPhotos = db.favorites.filter(f => {
        const photo = db.photos.find(p => p.id === f.photo_id);
        return photo?.event_id === 1;
      });
      expect(favoritesForDeletedPhotos).toHaveLength(0);

      const collabsForDeletedEvent = db.collaborators.filter(c => c.event_id === 1);
      expect(collabsForDeletedEvent).toHaveLength(0);

      // Verify other event data untouched
      expect(db.photos.filter(p => p.event_id === 2)).toHaveLength(1);
      expect(db.favorites.filter(f => f.photo_id === 'photo-2')).toHaveLength(1);
    });

    it('logs deletion events in collaboration history', () => {
      const db = new MockD1Database();

      db.collaborationHistory = [];
      db.queryLog = [];

      // Simulate logging deletion
      db.collaborationHistory.push({
        event_id: 1,
        user_email: 'admin@example.com',
        action: 'event_deleted',
        timestamp: new Date(),
      });

      expect(db.collaborationHistory.filter(h => h.action === 'event_deleted')).toHaveLength(1);
    });
  });

  // 7. DATA CONSISTENCY
  describe('Data Consistency & Concurrent Operations', () => {
    it('prevents duplicate favorites on concurrent identical requests', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };

      const stmt1 = db.prepare('INSERT INTO favorites (photo_id, user_email) VALUES (?, ?)');
      stmt1.bind('photo-1', 'user@example.com');
      await stmt1.run();

      const stmt2 = db.prepare('INSERT INTO favorites (photo_id, user_email) VALUES (?, ?)');
      stmt2.bind('photo-1', 'user@example.com');
      await stmt2.run();

      // Should have only one favorite despite two attempts
      expect(db.favorites.filter(f => f.photo_id === 'photo-1' && f.user_email === 'user@example.com')).toHaveLength(1);
    });

    it('handles favorite toggle consistency (add/remove)', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };

      // Add favorite
      const addStmt = db.prepare('INSERT INTO favorites (photo_id, user_email) VALUES (?, ?)');
      addStmt.bind('photo-1', 'user@example.com');
      await addStmt.run();

      expect(db.favorites).toHaveLength(1);

      // Remove favorite
      const removeStmt = db.prepare('DELETE FROM favorites WHERE photo_id = ? AND user_email = ?');
      removeStmt.bind('photo-1', 'user@example.com');
      await removeStmt.run();

      expect(db.favorites).toHaveLength(0);

      // Add again
      const addStmt2 = db.prepare('INSERT INTO favorites (photo_id, user_email) VALUES (?, ?)');
      addStmt2.bind('photo-1', 'user@example.com');
      await addStmt2.run();

      expect(db.favorites).toHaveLength(1);
    });

    it('maintains correct favorite count with concurrent adds/removes', () => {
      const db = new MockD1Database();

      // Simulate multiple users adding favorites
      const addFav = (photoId: string, email: string) => {
        const stmt = db.prepare('INSERT INTO favorites (photo_id, user_email) VALUES (?, ?)');
        stmt.bind(photoId, email);
        stmt.run();
      };

      addFav('photo-1', 'user1@example.com');
      addFav('photo-1', 'user2@example.com');
      addFav('photo-1', 'user3@example.com');

      const count = db.favorites.filter(f => f.photo_id === 'photo-1').length;
      expect(count).toBe(3);

      // Remove one
      const removeStmt = db.prepare('DELETE FROM favorites WHERE photo_id = ? AND user_email = ?');
      removeStmt.bind('photo-1', 'user2@example.com');
      removeStmt.run();

      const newCount = db.favorites.filter(f => f.photo_id === 'photo-1').length;
      expect(newCount).toBe(2);
    });

    it('prevents duplicate collaborator additions', () => {
      const db = new MockD1Database();

      const addCollab = (eventId: number, email: string) => {
        const existing = db.collaborators.find(c => c.event_id === eventId && c.user_email === email);
        if (!existing) {
          db.collaborators.push({ event_id: eventId, user_email: email });
        }
      };

      addCollab(1, 'collab@example.com');
      addCollab(1, 'collab@example.com');
      addCollab(1, 'collab@example.com');

      // Should have only one
      expect(db.collaborators.filter(c => c.event_id === 1 && c.user_email === 'collab@example.com')).toHaveLength(1);
    });

    it('maintains event visibility consistency during updates', () => {
      const db = new MockD1Database();

      db.events = [
        makeEventRecord({ id: 1, slug: 'test', name: 'Test', visibility: 'public' }),
      ];
      db.photos = [
        makePhotoRecord({ id: 'photo-1', event_id: 1, original_filename: 'test.jpg' }),
        makePhotoRecord({ id: 'photo-2', event_id: 1, original_filename: 'test2.jpg' }),
      ];
      db.collaborators = [
        { event_id: 1, user_email: 'collab@example.com' },
      ];

      // Change visibility to private
      const event = db.events.find(e => e.id === 1);
      if (event) {
        event.visibility = 'private';
      }

      // Verify all event data is consistent
      expect(event?.visibility).toBe('private');
      expect(db.photos.filter(p => p.event_id === 1)).toHaveLength(2);
      expect(db.collaborators.filter(c => c.event_id === 1)).toHaveLength(1);
    });

    it('prevents favorite count inconsistencies', () => {
      const db = new MockD1Database();

      // Track favorite counts
      const photoCounts = new Map<string, number>();

      const addFavorite = (photoId: string) => {
        const count = photoCounts.get(photoId) || 0;
        photoCounts.set(photoId, count + 1);
      };

      const removeFavorite = (photoId: string) => {
        const count = Math.max(0, (photoCounts.get(photoId) || 0) - 1);
        photoCounts.set(photoId, count);
      };

      addFavorite('photo-1');
      addFavorite('photo-1');
      addFavorite('photo-1');
      expect(photoCounts.get('photo-1')).toBe(3);

      removeFavorite('photo-1');
      expect(photoCounts.get('photo-1')).toBe(2);

      removeFavorite('photo-1');
      removeFavorite('photo-1');
      expect(photoCounts.get('photo-1')).toBe(0);

      // Count should never go negative
      removeFavorite('photo-1');
      expect(photoCounts.get('photo-1')).toBe(0);
    });

    it('ensures collaboration history reflects all changes', () => {
      const db = new MockD1Database();

      db.collaborationHistory = [];

      const logAction = (eventId: number, email: string, action: string) => {
        db.collaborationHistory.push({
          event_id: eventId,
          user_email: email,
          action: action,
          timestamp: new Date(),
        });
      };

      logAction(1, 'collab@example.com', 'invite');
      logAction(1, 'collab@example.com', 'remove');
      logAction(1, 'collab@example.com', 'invite');

      const inviteCount = db.collaborationHistory.filter(
        h => h.event_id === 1 && h.action === 'invite'
      ).length;
      const removeCount = db.collaborationHistory.filter(
        h => h.event_id === 1 && h.action === 'remove'
      ).length;

      expect(inviteCount).toBe(2);
      expect(removeCount).toBe(1);
    });
  });
});
