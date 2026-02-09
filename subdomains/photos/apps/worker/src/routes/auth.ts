import { Hono } from 'hono';
import type { Env, Event, LoginRequest } from '../types';
import { verifyPassword } from '../utils';
import { createEventCookie } from '../cookies';
import { requireAuth, getUser } from '../auth';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/auth/login
 * Protected by Cloudflare Access - triggers authentication and redirects back
 */
app.get('/api/auth/login', requireAuth, async (c) => {
  const user = getUser(c);
  const returnTo = c.req.query('return_to') || '/favorites';
  
  if (!user) {
    return c.json({ error: 'Authentication failed' }, 401);
  }

  // User is authenticated, redirect back
  return c.redirect(returnTo);
});

/**
 * GET /api/auth/logout
 * Clears Cloudflare Access session and redirects home
 */
app.get('/api/auth/logout', async (c) => {
  // Redirect to Cloudflare logout with relative path
  return c.redirect('/cdn-cgi/access/logout');
});

/**
 * POST /api/events/:slug/login
 * Authenticates user for an event and sets session cookie
 */
app.post('/api/events/:slug/login', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const body = await c.req.json<LoginRequest>();
    
    if (!body.password) {
      return c.json({ error: 'Password is required' }, 400);
    }
    
    // Get event with password data
    const event = await c.env.DB
      .prepare('SELECT id, slug, name, password_salt, password_hash FROM events WHERE slug = ?')
      .bind(slug)
      .first<Event>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // If event has no password, allow access
    if (!event.password_salt || !event.password_hash) {
      return c.json({ error: 'This event is not password protected' }, 400);
    }
    
    // Verify password
    const isValid = await verifyPassword(body.password, event.password_salt, event.password_hash);
    
    if (!isValid) {
      return c.json({ error: 'Invalid password' }, 401);
    }
    
    // Create session cookie
    const cookie = await createEventCookie(slug, c.env.EVENT_COOKIE_SECRET);
    
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie,
      },
    });
  } catch (error) {
    console.error('Error logging in:', error);
    return c.json({ error: 'Failed to log in' }, 500);
  }
});

/**
 * POST /api/admin/logout
 * Clears admin session
 */
app.post('/api/admin/logout', async (c) => {
  try {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error logging out:', error);
    return c.json({ error: 'Failed to log out' }, 500);
  }
});

export default app;
