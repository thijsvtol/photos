import { Context, Next } from 'hono';
import type { Env, User, CloudflareAccessJWT, DBUser } from './types';

// Extend Hono context to include user
type Variables = {
  user: User;
};

/**
 * Extract and validate Cloudflare Access JWT from request headers or cookies
 * Cloudflare Access sets the Cf-Access-Jwt-Assertion header OR stores JWT in cookies
 */
export async function extractUser(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<User | null> {
  try {
    // Try to get JWT from header (for direct Access-protected routes)
    let jwt = c.req.header('Cf-Access-Jwt-Assertion') 
      || c.req.header('cf-access-jwt-assertion')
      || c.req.header('CF_Access_Jwt_Assertion');
    
    // If no header, try to get from cookie (for worker routes)
    if (!jwt) {
      const cookies = c.req.header('Cookie') || '';
      const match = cookies.match(/CF_Authorization=([^;]+)/);
      if (match) {
        jwt = match[1];
      }
    }
    
    if (!jwt) {
      console.log('No JWT found in headers or cookies. Available headers:', 
        Array.from(c.req.raw.headers.keys()).join(', '));
      return null;
    }

    console.log('JWT found, parsing...');

    // Decode JWT (Cloudflare Access already validates it at the edge)
    const payload = parseJWT(jwt);
    
    if (!payload || !payload.sub || !payload.email) {
      console.log('Invalid JWT payload:', payload);
      return null;
    }

    // Verify expiration
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      console.log('JWT expired');
      return null;
    }

    console.log('User authenticated:', payload.email);

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    };
  } catch (error) {
    console.error('Error extracting user:', error);
    return null;
  }
}

/**
 * Parse JWT without verification (Cloudflare Access validates at edge)
 */
function parseJWT(token: string): CloudflareAccessJWT | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(atob(parts[1]));
    return payload as CloudflareAccessJWT;
  } catch (error) {
    console.error('Error parsing JWT:', error);
    return null;
  }
}

/**
 * Middleware to require authentication
 * Returns 401 if user is not authenticated
 */
export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const user = await extractUser(c);
  
  if (!user) {
    // Log for debugging
    console.log('Authentication failed - no user found');
    console.log('Headers:', Object.fromEntries(c.req.raw.headers.entries()));
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Store user in context for use in route handlers
  c.set('user', user);
  
  // Upsert user in database (update last_login)
  await upsertUser(c.env.DB, user);
  
  await next();
}

/**
 * Middleware to optionally extract user (doesn't fail if not authenticated)
 */
export async function optionalAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const user = await extractUser(c);
  
  if (user) {
    c.set('user', user);
    await upsertUser(c.env.DB, user);
  }
  
  await next();
}

/**
 * Insert or update user in database
 */
async function upsertUser(db: D1Database, user: User): Promise<void> {
  try {
    await db
      .prepare(`
        INSERT INTO users (id, email, name, last_login)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          name = excluded.name,
          last_login = excluded.last_login
      `)
      .bind(user.id, user.email, user.name || null)
      .run();
  } catch (error) {
    console.error('Error upserting user:', error);
  }
}

/**
 * Get user from context (after authentication middleware)
 */
export function getUser(c: Context<{ Bindings: Env; Variables: Variables }>): User | null {
  return c.get('user') || null;
}

/**
 * Check if user is an admin based on email whitelist
 */
export function isAdmin(c: Context<{ Bindings: Env; Variables: Variables }>): boolean {
  const user = getUser(c);
  if (!user) return false;

  const adminEmails = c.env.ADMIN_EMAILS || '';
  const adminList = adminEmails.split(',').map(email => email.trim().toLowerCase());
  
  return adminList.includes(user.email.toLowerCase());
}

/**
 * Middleware to require admin access
 * Returns 403 if user is not an admin
 */
export async function requireAdmin(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const user = await extractUser(c);
  
  if (!user) {
    console.log('Admin access denied - no user found');
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Store user in context
  c.set('user', user);
  await upsertUser(c.env.DB, user);

  // Check if user is admin
  if (!isAdmin(c)) {
    console.log('Admin access denied for user:', user.email);
    return c.json({ error: 'Admin access required' }, 403);
  }

  console.log('Admin access granted:', user.email);
  await next();
}
