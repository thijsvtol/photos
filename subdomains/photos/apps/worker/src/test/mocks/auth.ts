import { vi } from 'vitest';
import type { User } from '../../types';

export let currentUser: User | null = null;
export let currentIsAdmin = false;
export let collaboratorAccessBySlug: Record<string, string[]> = {};

export function setupAuthMocks() {
  vi.mock('../../auth', () => {
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
          let slug = c.req.param('slug');
          if (!slug) {
            const match = c.req.path.match(/\/events\/([^/]+)\/uploads/);
            slug = match?.[1] || '';
          }
          if (!slug) {
            const allowedFallback = Object.values(collaboratorAccessBySlug).flat();
            if (!allowedFallback.includes(currentUser.email)) {
              return c.json({ error: 'Access forbidden' }, 403);
            }
            c.set('user', currentUser);
            await next();
            return;
          }

          const collaborator = await c.env.DB.prepare(
            'SELECT 1 FROM event_collaborators ec JOIN events e ON ec.event_id = e.id WHERE e.slug = ? AND ec.user_email = ?'
          ).bind(slug, currentUser.email).first();

          const allowedBySlug = collaboratorAccessBySlug[slug] || [];
          const allowedFallback = Object.values(collaboratorAccessBySlug).flat();
          if (!collaborator && !allowedBySlug.includes(currentUser.email) && !allowedFallback.includes(currentUser.email)) {
            return c.json({ error: 'Access forbidden' }, 403);
          }
        }
        c.set('user', currentUser);
        await next();
      },
      extractUser: async () => currentUser,
      checkEventAuth: async (c: any, eventSlug: string, hasPassword: boolean) => {
        if (!hasPassword) {
          return true;
        }

        const cookieHeader = c.req.header('Cookie') || '';
        const cookies = cookieHeader.split(';').map((cookie: string) => cookie.trim());
        const eventCookie = cookies.find((cookie: string) => cookie.startsWith(`ev_${eventSlug}=`));
        return Boolean(eventCookie);
      },
      getUser: (c: any) => c.get('user') || null,
      isAdmin: () => currentIsAdmin,
      isCollaborator: async () => false,
      isUserAdmin: () => false,
    };
  });
}

export function resetAuthState() {
  currentUser = null;
  currentIsAdmin = false;
  collaboratorAccessBySlug = {};
}
