import { Context, Next } from 'hono';
import type { Env, User, CloudflareAccessJWT, DBUser, CollaboratorRole } from './types';
import { jwtVerify } from 'jose';
import { hasEventSessionAccess } from './cookies';
import { createLogger, logger } from './logger';

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

    // Check for token query parameter (mobile image requests where headers can't be set)
    try {
      const url = new URL(c.req.url);
      const queryToken = url.searchParams.get('token');
      if (queryToken) {
        return await verifyBearerToken(c.env, queryToken);
      }
    } catch {
      // Ignore malformed URL
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
      const log = createLogger(c.env);
      log.debug('No JWT found in headers or cookies.');
      log.debug('Available headers:', Array.from(c.req.raw.headers.keys()).join(', '));
      log.debug('Cookie header:', c.req.header('Cookie')?.substring(0, 100));
      log.debug('Request URL:', c.req.url);
      return null;
    }

    const log = createLogger(c.env);
    log.debug('JWT found, parsing...');
    log.debug('JWT preview:', jwt.substring(0, 50) + '...');

    // Decode JWT (Cloudflare Access already validates it at the edge)
    const payload = parseJWT(jwt);
    
    if (!payload || !payload.sub || !payload.email) {
      log.debug('Invalid JWT payload:', payload);
      return null;
    }

    // Verify expiration
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      log.debug('JWT expired');
      return null;
    }

    log.debug('User authenticated:', payload.email);

    // Build name from available fields
    // Google login may provide given_name/family_name instead of name
    let userName = payload.name;
    if (!userName && (payload.given_name || payload.family_name)) {
      userName = [payload.given_name, payload.family_name].filter(Boolean).join(' ');
    }

    log.debug('User name extracted:', userName || 'No name available');

    return {
      id: payload.sub,
      email: payload.email,
      name: userName,
    };
  } catch (error) {
    logger.error('Error extracting user:', error);
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
    logger.error('Error parsing JWT:', error);
    return null;
  }
}

/**
 * Verify mobile OAuth Bearer token (JWT)
 */
export async function verifyBearerToken(env: Env, token: string): Promise<User | null> {
  try {
    if (!env.JWT_SECRET) {
      logger.error('JWT_SECRET not configured');
      return null;
    }

    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    if (payload.type !== 'mobile_oauth') {
      createLogger(env).debug('Invalid token type:', payload.type);
      return null;
    }

    return {
      id: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string | undefined,
    };
  } catch (error) {
    logger.error('Error verifying bearer token:', error);
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
    // Log for debugging (suppressed in production — the global
    // request-logging middleware in index.ts already logs the resulting
    // 401 at WARN level regardless).
    const log = createLogger(c.env);
    log.debug('Authentication failed - no user found');
    log.debug('Headers:', Object.fromEntries(c.req.raw.headers.entries()));
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
    logger.debug('Upserting user:', { email: user.email, name: user.name });
    
    // First check if user exists
    const existingUser = await db
      .prepare('SELECT email, name FROM users WHERE email = ?')
      .bind(user.email)
      .first();
    
    if (!existingUser) {
      // User doesn't exist, create with name from JWT (if available)
      logger.debug('Creating new user with name from JWT:', user.name);
      await db
        .prepare('INSERT INTO users (email, name, last_login) VALUES (?, ?, datetime(\'now\'))')
        .bind(user.email, user.name || null)
        .run();
    } else {
      // User exists - ONLY update last_login, preserve existing name
      logger.debug('User exists, updating only last_login. Existing name:', existingUser.name);
      await db
        .prepare('UPDATE users SET last_login = datetime(\'now\') WHERE email = ?')
        .bind(user.email)
        .run();
    }
    
    logger.debug('Upsert successful');
  } catch (error) {
    logger.error('Error upserting user:', error);
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
 * Check if a user is an admin based on User object (without context)
 */
export function isUserAdmin(user: User, adminEmails: string): boolean {
  if (!user) return false;
  const adminList = adminEmails.split(',').map(email => email.trim().toLowerCase());
  return adminList.includes(user.email.toLowerCase());
}

export type EventCapability =
  | 'upload'
  | 'image_edit'
  | 'photo_delete'
  | 'bulk_delete'
  | 'invite_create'
  | 'invite_revoke'
  | 'collaborator_remove'
  | 'role_change'
  | 'feature_photo';

const roleCapabilities: Record<CollaboratorRole, Set<EventCapability>> = {
  viewer: new Set(),
  uploader: new Set(['upload']),
  editor: new Set(['upload', 'image_edit', 'photo_delete', 'bulk_delete', 'invite_create']),
  admin: new Set(['upload', 'image_edit', 'photo_delete', 'bulk_delete', 'invite_create', 'invite_revoke', 'collaborator_remove', 'role_change', 'feature_photo']),
};

export function hasRoleCapability(role: CollaboratorRole | null, capability: EventCapability): boolean {
  if (!role) return false;
  return roleCapabilities[role].has(capability);
}

export async function getCollaboratorRole(
  db: D1Database,
  eventSlug: string,
  userEmail: string
): Promise<CollaboratorRole | null> {
  try {
    // Compare case-insensitively: emails can be stored with different casing
    // depending on how the collaborator was added (manual invite vs. accepted
    // link vs. OAuth login), and mismatched casing must not cause collaborators
    // to lose their permissions (e.g. spurious 403s when uploading).
    const result = await db.prepare(`
      SELECT ec.role
      FROM event_collaborators ec
      JOIN events e ON ec.event_id = e.id
      WHERE e.slug = ? AND LOWER(ec.user_email) = LOWER(?)
    `).bind(eventSlug, userEmail).first<{ role: CollaboratorRole }>();

    return result?.role ?? null;
  } catch (error) {
    logger.error('Error getting collaborator role:', error);
    return null;
  }
}

export async function getCollaboratorRoleByEventId(
  db: D1Database,
  eventId: number,
  userEmail: string
): Promise<CollaboratorRole | null> {
  try {
    // Case-insensitive match — see getCollaboratorRole() for rationale.
    const result = await db.prepare(`
      SELECT role
      FROM event_collaborators
      WHERE event_id = ? AND LOWER(user_email) = LOWER(?)
    `).bind(eventId, userEmail).first<{ role: CollaboratorRole }>();

    return result?.role ?? null;
  } catch (error) {
    logger.error('Error getting collaborator role by event id:', error);
    return null;
  }
}

export async function hasEventCapability(
  db: D1Database,
  eventSlug: string,
  userEmail: string,
  capability: EventCapability
): Promise<boolean> {
  const role = await getCollaboratorRole(db, eventSlug, userEmail);
  return hasRoleCapability(role, capability);
}

export async function hasEventCapabilityByEventId(
  db: D1Database,
  eventId: number,
  userEmail: string,
  capability: EventCapability
): Promise<boolean> {
  const role = await getCollaboratorRoleByEventId(db, eventId, userEmail);
  return hasRoleCapability(role, capability);
}

/**
 * Check event authentication using both cookies and Bearer tokens
 * Returns true if:
 * - Event has no password (public access), OR
 * - User has valid event session cookie (web), OR
 * - User has valid Bearer token AND is an admin (mobile app)
 */
export async function checkEventAuth(
  c: Context<{ Bindings: Env }>,
  eventSlug: string,
  hasPassword: boolean
): Promise<boolean> {
  // If event has no password, allow access
  if (!hasPassword) {
    return true;
  }

  // Check cookie/header/query event session token.
  const hasSessionAccess = await hasEventSessionAccess(
    c.req.raw,
    eventSlug,
    c.env.EVENT_COOKIE_SECRET
  );
  
  if (hasSessionAccess) {
    return true;
  }

  // Check for Bearer token (mobile app users) — in header or query param
  const authHeader = c.req.header('Authorization');
  let token: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    try {
      const url = new URL(c.req.url);
      token = url.searchParams.get('token');
    } catch {
      // Ignore malformed URL
    }
  }

  if (token) {
    const user = await verifyBearerToken(c.env, token);
    if (user) {
      // Allow admins
      if (isUserAdmin(user, c.env.ADMIN_EMAILS || '')) {
        return true;
      }
      // Allow any authenticated user to bypass event password
      // (collaborator check is done in requireMediaAccess)
      return true;
    }
  }

  return false;
}

/**
 * Middleware to require admin access
 * Returns 403 if user is not an admin
 */
export async function requireAdmin(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const user = await extractUser(c);
  
  const log = createLogger(c.env);
  if (!user) {
    log.debug('Admin access denied - no user found');
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Store user in context
  c.set('user', user);
  await upsertUser(c.env.DB, user);

  // Check if user is admin
  if (!isAdmin(c)) {
    log.debug('Admin access denied for user:', user.email);
    return c.json({ error: 'Admin access required' }, 403);
  }

  log.debug('Admin access granted:', user.email);
  await next();
}

/**
 * Check if user is a collaborator on a specific event
 */
export async function isCollaborator(db: D1Database, eventSlug: string, userEmail: string): Promise<boolean> {
  const role = await getCollaboratorRole(db, eventSlug, userEmail);
  return !!role;
}

export function requireEventCapability(capability: EventCapability, errorMessage?: string) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = await extractUser(c);

    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    c.set('user', user);
    await upsertUser(c.env.DB, user);

    // Global admins can always proceed
    if (isAdmin(c)) {
      await next();
      return;
    }

    const eventSlug = c.req.param('slug');
    if (!eventSlug) {
      return c.json({ error: 'Event context is required' }, 400);
    }

    const allowed = await hasEventCapability(c.env.DB, eventSlug, user.email, capability);
    if (!allowed) {
      return c.json({ error: errorMessage || 'Insufficient permissions for this event' }, 403);
    }

    await next();
  };
}

/**
 * Middleware to require event view access (admin or any event collaborator).
 * Use this for read-only, per-event endpoints (e.g. event stats) that
 * collaborators need while uploading, but that shouldn't be exposed publicly.
 */
export async function requireEventViewAccess(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const user = await extractUser(c);

  const log = createLogger(c.env);
  if (!user) {
    log.debug('Event view access denied - no user found');
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Store user in context
  c.set('user', user);
  await upsertUser(c.env.DB, user);

  // Global admins can always proceed
  if (isAdmin(c)) {
    await next();
    return;
  }

  // Any collaborator (regardless of role) can view event stats
  const eventSlug = c.req.param('slug');
  if (eventSlug && await isCollaborator(c.env.DB, eventSlug, user.email)) {
    await next();
    return;
  }

  log.debug('Event view access denied for user:', user.email);
  return c.json({ error: 'You do not have access to this event.' }, 403);
}

/**
 * Middleware to require upload permission (admin or event collaborator)
 * Use this for upload endpoints that should allow both admins and collaborators
 */
export async function requireUploadPermission(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const user = await extractUser(c);
  
  const log = createLogger(c.env);
  if (!user) {
    log.debug('Upload access denied - no user found');
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Store user in context
  c.set('user', user);
  await upsertUser(c.env.DB, user);

  // Check if user is admin (admins can upload to any event)
  if (isAdmin(c)) {
    log.debug('Upload access granted (admin):', user.email);
    await next();
    return;
  }

  // Check if user has upload capability on this specific event
  const eventSlug = c.req.param('slug');
  if (eventSlug && await hasEventCapability(c.env.DB, eventSlug, user.email, 'upload')) {
    log.debug('Upload access granted (collaborator):', user.email, 'for event:', eventSlug);
    await next();
    return;
  }

  log.debug('Upload access denied for user:', user.email);
  return c.json({ error: 'Upload permission required. You must be an admin or have upload access for this event.' }, 403);
}
