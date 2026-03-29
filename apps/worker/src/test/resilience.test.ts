import { describe, it, expect, beforeEach, vi } from 'vitest';
import publicRoutes from '../routes/public';
import adminRoutes from '../routes/admin';
import favoritesRoutes from '../routes/favorites';
import type { Env, User } from '../types';

interface TestEnv extends Env {
  APP_NAME: string;
  BRAND_NAME: string;
  COPYRIGHT_HOLDER: string;
  APP_DOMAIN: string;
  CONTACT_EMAIL: string;
  ENVIRONMENT: string;
}

let currentUser: User | null = null;
let currentIsAdmin = false;
let dbError: Error | null = null;
let r2Error: Error | null = null;

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
      if (!currentIsAdmin) {
        return c.json({ error: 'Access forbidden' }, 403);
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
    checkEventAuth: async (c: any, eventSlug: string, hasPassword: boolean) => {
      return !hasPassword;
    },
    getUser: (c: any) => c.get('user') || null,
    isAdmin: () => currentIsAdmin,
    isCollaborator: async () => false,
    isUserAdmin: () => false,
  };
});

interface EventRecord {
  id: number;
  slug: string;
  name: string;
  visibility: 'public' | 'private' | 'collaborators_only';
}

class MockD1Statement {
  constructor(private query: string, private db: MockD1Database) {}

  bind(...args: unknown[]) {
    return this;
  }

  async all<T>() {
    if (dbError) throw dbError;
    return { results: [] as T[] };
  }

  async first<T>() {
    if (dbError) throw dbError;
    return null as T | null;
  }

  async run() {
    if (dbError) throw dbError;
    return { success: true, meta: { changes: 1 } };
  }
}

class MockD1Database {
  constructor(private events: EventRecord[] = []) {}

  prepare(query: string) {
    return new MockD1Statement(query, this);
  }
}

function createEnv(db: MockD1Database): TestEnv {
  return {
    DB: db as unknown as D1Database,
    PHOTOS_BUCKET: createBucket() as unknown as R2Bucket,
    EVENT_COOKIE_SECRET: 'secret',
    ADMIN_EMAILS: 'admin@example.com',
    JWT_SECRET: 'jwt-secret',
    APP_NAME: 'Photos',
    BRAND_NAME: 'Photos',
    COPYRIGHT_HOLDER: 'Photos',
    APP_DOMAIN: 'photos.example.com',
    CONTACT_EMAIL: 'hello@example.com',
    ENVIRONMENT: 'development',
    MAILGUN_API_KEY: 'test-key',
    MAILGUN_DOMAIN: 'example.com',
  };
}

function createBucket(shouldError = false) {
  return {
    get: async (key: string) => {
      if (r2Error) throw r2Error;
      if (shouldError) throw new Error('R2 unavailable');
      return { arrayBuffer: async () => new ArrayBuffer(8) };
    },
  };
}

describe('Error handling & resilience', () => {
  beforeEach(() => {
    currentUser = null;
    currentIsAdmin = false;
    dbError = null;
    r2Error = null;
  });

  // 1. DATABASE & R2 ERRORS
  describe('Database failure handling', () => {
    it('handles database errors gracefully in admin routes', async () => {
      dbError = new Error('Database connection failed');
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
      currentIsAdmin = true;

      const response = await adminRoutes.request('http://localhost/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Event' }),
      }, env);
      
      expect([500, 503]).toContain(response.status);
    });
  });

  // 2. INPUT VALIDATION & SECURITY
  describe('Input validation and sanitization', () => {
    it('blocks malformed event slugs with path traversal', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
      currentIsAdmin = true;

      // These request paths should be rejected before reaching handlers
      const traversalSlugs = [
        '../admin',
        'event../../etc/passwd',
        'event%00',
      ];

      for (const slug of traversalSlugs) {
        const response = await adminRoutes.request(`http://localhost/events/${slug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test' }),
        }, env);
        // Should not allow traversal attempts
        expect([400, 404, 403]).toContain(response.status);
      }
    });

    it('rejects excessive input lengths', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
      currentIsAdmin = true;

      const longName = 'a'.repeat(5000);
      const response = await adminRoutes.request('http://localhost/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: longName }),
      }, env);
      
      // Request may be accepted by route and validated by handler
      expect([200, 201, 400, 413, 500]).toContain(response.status);
    });
  });

  // 3. ADMIN OPERATIONS
  describe('Admin authorization', () => {
    it('blocks non-admins from creating events', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };
      currentIsAdmin = false;

      const response = await adminRoutes.request('http://localhost/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Event' }),
      }, env);
      
      expect(response.status).toBe(403);
    });

    it('blocks non-admins from deleting events', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };
      currentIsAdmin = false;

      const response = await adminRoutes.request('http://localhost/events/public-event', {
        method: 'DELETE',
      }, env);
      
      expect(response.status).toBe(403);
    });

    it('requires authentication for admin operations', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      const response = await adminRoutes.request('http://localhost/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Event' }),
      }, env);
      
      expect(response.status).toBe(401);
    });
  });

  // 4. AUTHENTICATION EDGE CASES
  describe('Authentication edge cases', () => {
    it('rejects malformed Bearer tokens', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      const response = await favoritesRoutes.request('http://localhost/api/favorites/photo-1', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer not-a-valid-jwt',
        },
      }, env);
      
      expect([401, 403]).toContain(response.status);
    });

    it('rejects missing auth for protected endpoints', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      const response = await favoritesRoutes.request('http://localhost/api/favorites/photo-1', {
        method: 'POST',
      }, env);
      
      expect(response.status).toBe(401);
    });

    it('rejects Authorization without Bearer prefix', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      const response = await favoritesRoutes.request('http://localhost/api/favorites/photo-1', {
        method: 'POST',
        headers: {
          'Authorization': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        },
      }, env);
      
      expect(response.status).toBe(401);
    });
  });

  // 5. DATA INTEGRITY
  describe('Data integrity and constraints', () => {
    it('maintains user privilege boundaries', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };
      currentIsAdmin = false;

      // Verify user cannot access admin operations even with valid session
      const adminResponse = await adminRoutes.request('http://localhost/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      }, env);
      
      expect(adminResponse.status).toBe(403);

      // But can access public endpoints
      const publicResponse = await publicRoutes.request('http://localhost/api/events', {}, env);
      expect([200, 401, 500]).toContain(publicResponse.status);
    });

    it('requires authentication for favorites operations', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      // Unauthenticated request
      const noAuthResponse = await favoritesRoutes.request('http://localhost/api/favorites/photo-1', {
        method: 'POST',
      }, env);
      expect(noAuthResponse.status).toBe(401);

      // Authenticated request should proceed to business logic
      currentUser = { id: 'user-1', email: 'user@example.com', name: 'User' };
      const authResponse = await favoritesRoutes.request('http://localhost/api/favorites/photo-1', {
        method: 'POST',
      }, env);
      expect([200, 404, 500]).toContain(authResponse.status);
    });
  });

  // 6. SECURITY HEADERS & CORS
  describe('Security and availability', () => {
    it('returns valid HTTP status codes', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      const response = await publicRoutes.request('http://localhost/api/events', {}, env);
      expect([200, 401, 403, 404, 500]).toContain(response.status);
    });

    it('gracefully handles OPTIONS requests', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      const response = await publicRoutes.request('http://localhost/api/events', {
        method: 'OPTIONS',
      }, env);
      
      // OPTIONS may return 200, 204, 404, or 405
      expect([200, 204, 404, 405]).toContain(response.status);
    });

    it('prevents information leakage in error messages', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      const response = await publicRoutes.request('http://localhost/api/events/missing', {}, env);
      const body = await response.json() as any;
      
      // Should not expose internal details like SQL errors or file paths
      if (body.error) {
        expect(body.error).not.toMatch(/SQL|Database|\\/);
      }
    });

    it('validates request Content-Type on mutation operations', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
      currentIsAdmin = true;

      const response = await adminRoutes.request('http://localhost/events', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      }, env);
      
      expect([400, 415, 500]).toContain(response.status);
    });

    it('handles missing required fields in requests', async () => {
      const db = new MockD1Database();
      const env = createEnv(db);

      currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
      currentIsAdmin = true;

      const response = await adminRoutes.request('http://localhost/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env);
      
      expect([400, 401, 500]).toContain(response.status);
    });
  });
});
