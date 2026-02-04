import { Hono } from 'hono';
import type { Env, Event, LoginRequest } from '../types';
import { verifyPassword } from '../utils';
import { createEventCookie } from '../cookies';

const app = new Hono<{ Bindings: Env }>();

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

export default app;
