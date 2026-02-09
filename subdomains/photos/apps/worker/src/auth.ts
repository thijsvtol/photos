import { Context, Next } from 'hono';
import type { Env, User, CloudflareAccessJWT, DBUser } from './types';
import { jwtVerify } from 'jose';

// Extend Hono context to include user
type Variables = {
  user: User;
};

/**
 * Extract and validate Cloudflare Access JWT from request headers or cookies
 * Also supports Bearer tokens for mobile OAuth
 */
export async function extractUser(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<User | null> {
  try {
    // First check for Bearer token (mobile OAuth)
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      return await verifyBearerToken(c.env, token);
    }

    // Then try Cloudflare Access JWT (web)
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
      console.log('No JWT found in headers or cookies.');
      console.log('Available headers:', Array.from(c.req.raw.headers.keys()).join(', '));
      console.log('Cookie header:', c.req.header('Cookie')?.substring(0, 100));
      console.log('Request URL:', c.req.url);
      return null;
    }

    console.log('JWT found, parsing...');
    console.log('JWT preview:', jwt.substring(0, 50) + '...');

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

    // Build name from available fields
    // Google login may provide given_name/family_name instead of name
    let userName = payload.name;
    if (!userName && (payload.given_name || payload.family_name)) {
      userName = [payload.given_name, payload.family_name].filter(Boolean).join(' ');
    }

    console.log('User name extracted:', userName || 'No name available');

    return {
      id: payload.sub,
      email: payload.email,
      name: userName,
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
 * Verify mobile OAuth Bearer token (JWT)
 */
async function verifyBearerToken(env: Env, token: string): Promise<User | null> {
  try {
    if (!env.JWT_SECRET) {
      console.error('JWT_SECRET not configured');
      return null;
    }

    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    if (payload.type !== 'mobile_oauth') {
      console.log('Invalid token type:', payload.type);
      return null;
    }

    return {
      id: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string | undefined,
    };
  } catch (error) {
    console.error('Error verifying bearer token:', error);
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
    // Upsert user to database (email is primary key)
    await upsertUser(c.env.DB, user);
    // Use email as the identifier (not JWT sub which can change)
    c.set('user', user);
  }
  
  await next();
}

/**
 * Insert or update user in database (email is primary key)
 */
async function upsertUser(db: D1Database, user: User): Promise<void> {
  try {
    console.log('Upserting user:', { email: user.email, name: user.name });
    const result = await db
      .prepare(`
        INSERT INTO users (email, name, last_login)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(email) DO UPDATE SET
          name = excluded.name,
          last_login = excluded.last_login
      `)
      .bind(user.email, user.name || null)
      .run();
    console.log('Upsert successful:', result.success);
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

/**
 * Check if user is a collaborator on a specific event
 */
export async function isCollaborator(db: D1Database, eventSlug: string, userEmail: string): Promise<boolean> {
  try {
    const result = await db.prepare(`
      SELECT 1
      FROM event_collaborators ec
      JOIN events e ON ec.event_id = e.id
      WHERE e.slug = ? AND ec.user_email = ?
    `).bind(eventSlug, userEmail).first();
    
    return !!result;
  } catch (error) {
    console.error('Error checking collaborator status:', error);
    return false;
  }
}

/**
 * Middleware to require upload permission (admin or event collaborator)
 * Use this for upload endpoints that should allow both admins and collaborators
 */
export async function requireUploadPermission(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const user = await extractUser(c);
  
  if (!user) {
    console.log('Upload access denied - no user found');
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Store user in context
  c.set('user', user);
  await upsertUser(c.env.DB, user);

  // Check if user is admin (admins can upload to any event)
  if (isAdmin(c)) {
    console.log('Upload access granted (admin):', user.email);
    await next();
    return;
  }

  // Check if user is a collaborator on this specific event
  const eventSlug = c.req.param('slug');
  if (eventSlug && await isCollaborator(c.env.DB, eventSlug, user.email)) {
    console.log('Upload access granted (collaborator):', user.email, 'for event:', eventSlug);
    await next();
    return;
  }

  console.log('Upload access denied for user:', user.email);
  return c.json({ error: 'Upload permission required. You must be an admin or invited collaborator.' }, 403);
}
