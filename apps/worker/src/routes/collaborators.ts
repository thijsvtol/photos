import { Hono } from 'hono';
import type { Env, InviteCollaboratorRequest, CollaboratorWithUser, User, CollaboratorRole } from '../types';
import { requireAdmin, extractUser, requireEventCapability, isAdmin, getCollaboratorRole, getCollaboratorRoleByEventId } from '../auth';
import { requireFeature } from '../features';
import { getConfig } from '../config';
import { logger } from '../logger';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const VALID_ROLES: CollaboratorRole[] = ['viewer', 'uploader', 'editor', 'admin'];

const roleRank: Record<CollaboratorRole, number> = {
  viewer: 0,
  uploader: 1,
  editor: 2,
  admin: 3,
};

const normalizeRole = (value: unknown): CollaboratorRole | null => {
  if (typeof value !== 'string') return null;
  if (VALID_ROLES.includes(value as CollaboratorRole)) {
    return value as CollaboratorRole;
  }
  return null;
};

// Case-insensitive lookup — see getCollaboratorRole() in auth.ts for rationale.
const getEventCollaboratorRole = getCollaboratorRoleByEventId;

// Require collaborators feature to be enabled for all routes
app.use('/*', requireFeature('enableCollaborators'));

/**
 * GET /api/events/:slug/collaborators
 * Get all collaborators for an event
 * Public endpoint - allows anyone who can view the event to see collaborators
 *
 * Includes the collaborator's linked person's id + cover photo + name (person_clusters, via
 * linked_user_email — see AdminPersonDetail's "Linked account" section for how that link is
 * set) so the public-facing collaborator display (CollaboratorAvatars.tsx) can show an actual
 * photo of them instead of only ever falling back to initials, and so its "View photos of X"
 * detail modal can deep-link into the combined Timeline/Search page's people filter
 * (?people=<person_id>) for that person. `person_name` is specifically a fallback display name
 * for a collaborator who hasn't set their own account name yet (see the "force a name on
 * login" flow) but HAS already been identified/named as a person elsewhere in the library —
 * showing that name is strictly better than the generic "Collaborator" placeholder, and no
 * less accurate (it's the same real person either way).
 */
app.get('/api/events/:slug/collaborators', async (c) => {
  const slug = c.req.param('slug')!;
  
  try {
    // Get event ID from slug
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get collaborators with user info
    const collaborators = await c.env.DB.prepare(`
      SELECT 
        ec.event_id,
        ec.user_email,
        ec.invited_at,
        ec.role,
        u.email,
        u.name,
        pc.id as person_id,
        pc.name as person_name,
        p.id as cover_photo_id,
        p.file_type as cover_file_type,
        p.cache_version as cover_cache_version,
        e2.slug as cover_event_slug
      FROM event_collaborators ec
      LEFT JOIN users u ON ec.user_email = u.email
      LEFT JOIN person_clusters pc ON LOWER(pc.linked_user_email) = LOWER(ec.user_email)
      LEFT JOIN photos p ON p.id = pc.cover_photo_id
      LEFT JOIN events e2 ON e2.id = p.event_id
      WHERE ec.event_id = ?
      ORDER BY ec.invited_at DESC
    `).bind(event.id).all<CollaboratorWithUser>();
    
    return c.json({ collaborators: collaborators.results || [] });
  } catch (error) {
    logger.error('Error fetching collaborators:', error);
    return c.json({ error: 'Failed to fetch collaborators' }, 500);
  }
});

/**
 * POST /api/events/:slug/collaborators
 * Invite a user to collaborate on an event (editor/admin)
 */
app.post('/api/events/:slug/collaborators', requireEventCapability('invite_create', 'Invite permission required'), async (c) => {
  const slug = c.req.param('slug')!;
  logger.debug('[Invite Collaborator] Starting for event:', slug);
  
  const body = await c.req.json<InviteCollaboratorRequest>();
  logger.debug('[Invite Collaborator] Request body:', body);
  
  if (!body.email || !body.email.includes('@')) {
    logger.debug('[Invite Collaborator] Invalid email:', body.email);
    return c.json({ error: 'Valid email is required' }, 400);
  }
  
  const adminUser = await extractUser(c);
  if (!adminUser) {
    logger.debug('[Invite Collaborator] No admin user found');
    return c.json({ error: 'Unauthorized' }, 401);
  }
  logger.debug('[Invite Collaborator] Admin user:', adminUser.email);
  
  const requestedRole = normalizeRole(body.role) || 'uploader';

  try {
        // Editors cannot grant event-admin role
        if (!isAdmin(c)) {
          const inviterRole = await getCollaboratorRole(c.env.DB, slug, adminUser.email);
          if (!inviterRole || roleRank[requestedRole] > roleRank[inviterRole]) {
            return c.json({ error: 'Cannot assign a role higher than your own' }, 403);
          }
        }

    // Get event ID from slug
    const event = await c.env.DB.prepare(
      'SELECT id, name FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number; name: string }>();
    
    if (!event) {
      logger.debug('[Invite Collaborator] Event not found:', slug);
      return c.json({ error: 'Event not found' }, 404);
    }
    logger.debug('[Invite Collaborator] Event found:', event.id, event.name);
    
    // Check if user exists, create if not
    let user = await c.env.DB.prepare(
      'SELECT email, name FROM users WHERE LOWER(email) = LOWER(?)'
    ).bind(body.email).first<{ email: string; name: string | null }>();
    
    if (!user) {
      logger.debug('[Invite Collaborator] User not found, creating new user');
      // Normalize to lowercase so this matches the casing extracted from the
      // user's own auth session when they eventually log in (avoids a
      // mismatch that would silently deny them permissions, e.g. a 403 on
      // upload, if they typed a different-case email at login than the
      // admin used here).
      const normalizedEmail = body.email.toLowerCase();
      // Create a placeholder user (they'll be fully created when they first log in)
      const createResult = await c.env.DB.prepare(
        'INSERT INTO users (email, name) VALUES (?, ?)'
      ).bind(normalizedEmail, null).run();
      logger.debug('[Invite Collaborator] User creation result:', createResult.success);
      
      user = { email: normalizedEmail, name: null };
    } else {
      logger.debug('[Invite Collaborator] User exists:', user.email);
    }
    
    // Check if collaborator relationship already exists
    const existing = await c.env.DB.prepare(
      'SELECT 1 FROM event_collaborators WHERE event_id = ? AND user_email = ?'
    ).bind(event.id, user.email).first();
    
    if (existing) {
      logger.debug('[Invite Collaborator] Collaborator already exists');
      return c.json({ error: 'User is already a collaborator' }, 400);
    }
    
    // Create collaborator relationship
    logger.debug('[Invite Collaborator] Creating collaborator relationship');
    const insertResult = await c.env.DB.prepare(`
      INSERT INTO event_collaborators (event_id, user_email, role)
      VALUES (?, ?, ?)
    `).bind(event.id, user.email, requestedRole).run();
    logger.debug('[Invite Collaborator] Insert result:', insertResult.success, insertResult.meta);
    
    if (!insertResult.success) {
      logger.error('[Invite Collaborator] Failed to insert collaborator');
      return c.json({ error: 'Failed to create collaborator relationship' }, 500);
    }
    
    // Log collaboration action
    await logCollaborationAction(c.env.DB, {
      eventId: event.id,
      userEmail: adminUser.email,
      actionType: 'invite',
      targetUserEmail: user.email,
      metadata: { email: user.email, name: user.name }
    });
    
    // Send invitation email
    logger.debug('[Invite Collaborator] Sending invitation email to:', body.email);
    await sendInvitationEmail(c.env, {
      to: body.email,
      eventName: event.name,
      eventSlug: slug,
      invitedBy: adminUser.name || adminUser.email
    });
    
    logger.debug('[Invite Collaborator] Successfully completed');
    return c.json({ 
      message: 'Collaborator invited successfully',
      collaborator: {
        user_email: user.email,
        email: user.email,
        name: user.name,
        role: requestedRole,
      }
    });
  } catch (error) {
    logger.error('[Invite Collaborator] Error:', error);
    return c.json({ error: 'Failed to invite collaborator' }, 500);
  }
});

/**
 * DELETE /api/events/:slug/collaborators/:userEmail
 * Remove a collaborator from an event (event admin only)
 */
app.delete('/api/events/:slug/collaborators/:userEmail', requireEventCapability('collaborator_remove', 'Admin collaborator role required'), async (c) => {
  const slug = c.req.param('slug')!;
  const userEmail = c.req.param('userEmail');

  if (!userEmail) {
    return c.json({ error: 'Collaborator email is required' }, 400);
  }
  
  try {
    // Get event ID from slug
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }

    const existingRole = await getEventCollaboratorRole(c.env.DB, event.id, userEmail);
    if (!existingRole) {
      return c.json({ error: 'Collaborator not found' }, 404);
    }

    // Delete collaborator relationship (case-insensitive, matching the
    // lookup above — see getCollaboratorRole() for rationale).
    const result = await c.env.DB.prepare(
      'DELETE FROM event_collaborators WHERE event_id = ? AND LOWER(user_email) = LOWER(?)'
    ).bind(event.id, userEmail).run();
    
    if (result.meta.changes === 0) {
      return c.json({ error: 'Collaborator not found' }, 404);
    }
    
    // Log collaboration action
    const adminUser = await extractUser(c);
    if (adminUser) {
      await logCollaborationAction(c.env.DB, {
        eventId: event.id,
        userEmail: adminUser.email,
        actionType: 'remove',
        targetUserEmail: userEmail
      });
    }
    
    return c.json({ message: 'Collaborator removed successfully' });
  } catch (error) {
    logger.error('Error removing collaborator:', error);
    return c.json({ error: 'Failed to remove collaborator' }, 500);
  }
});

/**
 * PUT /api/events/:slug/collaborators/:userEmail/role
 * Update collaborator role for an event (event admin only)
 */
app.put('/api/events/:slug/collaborators/:userEmail/role', requireEventCapability('role_change', 'Admin collaborator role required'), async (c) => {
  const slug = c.req.param('slug')!;
  const userEmail = c.req.param('userEmail');

  if (!userEmail) {
    return c.json({ error: 'Collaborator email is required' }, 400);
  }

  const body = await c.req.json<{ role?: CollaboratorRole }>();
  const nextRole = normalizeRole(body.role);

  if (!nextRole) {
    return c.json({ error: 'Valid role is required' }, 400);
  }

  try {
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();

    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }

    const existingRole = await getEventCollaboratorRole(c.env.DB, event.id, userEmail);
    if (!existingRole) {
      return c.json({ error: 'Collaborator not found' }, 404);
    }

    const result = await c.env.DB.prepare(`
      UPDATE event_collaborators
      SET role = ?
      WHERE event_id = ? AND LOWER(user_email) = LOWER(?)
    `).bind(nextRole, event.id, userEmail).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Collaborator not found' }, 404);
    }

    return c.json({ success: true, role: nextRole });
  } catch (error) {
    logger.error('Error updating collaborator role:', error);
    return c.json({ error: 'Failed to update collaborator role' }, 500);
  }
});

/**
 * GET /api/user/collaborations
 * Get events the current user can collaborate on
 */
app.get('/api/user/collaborations', async (c) => {
  const user = await extractUser(c);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  try {
    const collaborations = await c.env.DB.prepare(`
      SELECT 
        e.id,
        e.slug,
        e.name,
        e.inferred_date,
        ec.invited_at
      FROM event_collaborators ec
      JOIN events e ON ec.event_id = e.id
      WHERE ec.user_email = ?
      ORDER BY ec.invited_at DESC
    `).bind(user.email).all();
    
    return c.json({ events: collaborations.results || [] });
  } catch (error) {
    logger.error('Error fetching collaborations:', error);
    return c.json({ error: 'Failed to fetch collaborations' }, 500);
  }
});

/**
 * GET /api/users/search
 * Search for users by email (admin only, for autocomplete)
 */
app.get('/api/users/search', requireAdmin, async (c) => {
  const query = c.req.query('q') || '';
  
  if (!query || query.length < 2) {
    return c.json({ users: [] });
  }
  
  try {
    const users = await c.env.DB.prepare(`
      SELECT email, name
      FROM users
      WHERE LOWER(email) LIKE LOWER(?)
      ORDER BY email
      LIMIT 10
    `).bind(`%${query}%`).all();
    
    return c.json({ users: users.results || [] });
  } catch (error) {
    logger.error('Error searching users:', error);
    return c.json({ error: 'Failed to search users' }, 500);
  }
});

/**
 * GET /api/events/:slug/collaboration-history
 * Get collaboration history for an event (admin only)
 */
app.get('/api/events/:slug/collaboration-history', requireAdmin, async (c) => {
  const slug = c.req.param('slug')!;
  
  try {
    // Get event ID from slug
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get history with user names
    const history = await c.env.DB.prepare(`
      SELECT 
        h.id,
        h.event_id,
        h.user_email,
        h.action_type,
        h.target_user_email,
        h.metadata,
        h.created_at,
        u.name as user_name,
        u.email as user_email,
        target.name as target_user_name,
        target.email as target_user_email
      FROM collaboration_history h
      LEFT JOIN users u ON h.user_email = u.email
      LEFT JOIN users target ON h.target_user_email = target.email
      WHERE h.event_id = ?
      ORDER BY h.created_at DESC
      LIMIT 100
    `).bind(event.id).all();
    
    // Parse metadata JSON
    const parsedHistory = (history.results || []).map((item: any) => ({
      ...item,
      metadata: item.metadata ? JSON.parse(item.metadata) : null
    }));
    
    return c.json({ history: parsedHistory });
  } catch (error) {
    logger.error('Error fetching collaboration history:', error);
    return c.json({ error: 'Failed to fetch history' }, 500);
  }
});

/**
 * Helper function to log collaboration actions
 */
export async function logCollaborationAction(
  db: D1Database,
  params: {
    eventId: number;
    userEmail: string;
    actionType: 'invite' | 'accept' | 'decline' | 'remove' | 'upload';
    targetUserEmail?: string;
    metadata?: any;
  }
) {
  try {
    await db.prepare(`
      INSERT INTO collaboration_history (event_id, user_email, action_type, target_user_email, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      params.eventId,
      params.userEmail,
      params.actionType,
      params.targetUserEmail || null,
      params.metadata ? JSON.stringify(params.metadata) : null
    ).run();
  } catch (error) {
    logger.error('[Collaboration History] Error logging action:', error);
    // Don't throw - logging failures shouldn't break the main flow
  }
}

/**
 * Send invitation email to collaborator using Mailgun
 */
async function sendInvitationEmail(env: Env, params: {
  to: string;
  eventName: string;
  eventSlug: string;
  invitedBy: string;
}) {
  // Check if email service is configured
  if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
    logger.warn('Mailgun not configured (missing MAILGUN_API_KEY or MAILGUN_DOMAIN), skipping invitation email');
    return;
  }
  
  const config = getConfig(env);
  const inviteUrl = `https://${config.domain}/events/${params.eventSlug}`;
  
  const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #3b82f6; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>You've been invited to collaborate!</h1>
    </div>
    <div class="content">
      <p>Hi there,</p>
      <p><strong>${params.invitedBy}</strong> has invited you to contribute photos to the event:</p>
      <h2>${params.eventName}</h2>
      <p>You can now upload your photos and videos to this event directly.</p>
      <a href="${inviteUrl}" class="button">View Event & Upload Photos</a>
      <p>Simply click the link above, log in with your Google account, and start uploading!</p>
    </div>
    <div class="footer">
      <p>${config.brandName} | ${config.domain}</p>
    </div>
  </div>
</body>
</html>
  `.trim();
  
  try {
    // Use Cloudflare Workers native FormData
    const formData = new FormData();
    formData.append('from', `${config.brandName} <noreply@${env.MAILGUN_DOMAIN}>`);
    formData.append('to', params.to);
    formData.append('subject', `You've been invited to collaborate on "${params.eventName}"`);
    formData.append('html', emailBody);
    
    // Use EU endpoint for Mailgun
    const response = await fetch(`https://api.eu.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa('api:' + env.MAILGUN_API_KEY),
      },
      body: formData
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Mailgun] Failed to send email:', response.status, errorText);
    } else {
      const result: any = await response.json();
      logger.debug('[Mailgun] Email sent successfully to:', params.to, 'ID:', result.id);
    }
  } catch (error: any) {
    logger.error('[Mailgun] Error sending invitation email:', error);
    // Don't fail the request if email fails
  }
}

/**
 * Send upload notification email to event admin
 */
export async function sendUploadNotification(env: Env, params: {
  adminEmail: string;
  adminName: string | null;
  uploaderName: string | null;
  uploaderEmail: string;
  eventName: string;
  eventSlug: string;
  photoCount: number;
}) {
  // Check if email service is configured
  if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
    logger.warn('Mailgun not configured (missing MAILGUN_API_KEY or MAILGUN_DOMAIN), skipping upload notification');
    return;
  }
  
  const config = getConfig(env);
  const eventUrl = `https://${config.domain}/events/${params.eventSlug}`;
  const uploaderDisplayName = params.uploaderName || params.uploaderEmail;
  const adminDisplayName = params.adminName || 'Admin';
  
  const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .stats { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📸 New Photos Uploaded!</h1>
    </div>
    <div class="content">
      <p>Hi ${adminDisplayName},</p>
      <p><strong>${uploaderDisplayName}</strong> has uploaded new photos to your event:</p>
      <h2>${params.eventName}</h2>
      <div class="stats">
        <p><strong>${params.photoCount}</strong> new ${params.photoCount === 1 ? 'photo' : 'photos'} added</p>
      </div>
      <a href="${eventUrl}" class="button">View Event Photos</a>
      <p>You can review and manage the uploaded photos in your event gallery.</p>
    </div>
    <div class="footer">
      <p>${config.brandName} | ${config.domain}</p>
    </div>
  </div>
</body>
</html>
  `.trim();
  
  try {
    // Use Cloudflare Workers native FormData
    const formData = new FormData();
    formData.append('from', `${config.brandName} <noreply@${env.MAILGUN_DOMAIN}>`);
    formData.append('to', params.adminEmail);
    formData.append('subject', `New photos uploaded to "${params.eventName}" by ${uploaderDisplayName}`);
    formData.append('html', emailBody);
    
    // Use EU endpoint for Mailgun
    const response = await fetch(`https://api.eu.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa('api:' + env.MAILGUN_API_KEY),
      },
      body: formData
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Mailgun] Failed to send upload notification:', response.status, errorText);
    } else {
      const result: any = await response.json();
      logger.debug('[Mailgun] Upload notification sent to:', params.adminEmail, 'ID:', result.id);
    }
  } catch (error: any) {
    logger.error('[Mailgun] Error sending upload notification:', error);
    // Don't fail the request if email fails
  }
}

/**
 * POST /api/events/:slug/invite-links
 * Create a shareable invite link for an event (editor/admin)
 */
app.post('/api/events/:slug/invite-links', requireEventCapability('invite_create', 'Invite permission required'), async (c) => {
  const slug = c.req.param('slug')!;
  const user = c.get('user');
  const body = await c.req
    .json<{ role?: CollaboratorRole }>()
    .catch((): { role?: CollaboratorRole } => ({}));
  const requestedRole = normalizeRole(body.role) || 'uploader';

  if (!isAdmin(c)) {
    const creatorRole = await getCollaboratorRole(c.env.DB, slug, user.email);
    if (!creatorRole || roleRank[requestedRole] > roleRank[creatorRole]) {
      return c.json({ error: 'Cannot create invite with a role higher than your own' }, 403);
    }
  }
  
  try {
    // Get event
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Generate secure token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Create invite link
    const result = await c.env.DB.prepare(`
      INSERT INTO invite_links (token, event_id, created_by, role)
      VALUES (?, ?, ?, ?)
    `).bind(token, event.id, user.email, requestedRole).run();
    
    if (!result.success) {
      throw new Error('Failed to create invite link');
    }
    
    // Get the created link with creator info
    const inviteLink = await c.env.DB.prepare(`
      SELECT 
        il.*,
        u.name as creator_name,
        e.name as event_name,
        e.slug as event_slug
      FROM invite_links il
      LEFT JOIN users u ON il.created_by = u.email
      LEFT JOIN events e ON il.event_id = e.id
      WHERE il.token = ?
    `).bind(token).first();
    
    // Log the action
    await c.env.DB.prepare(`
      INSERT INTO collaboration_history (event_id, user_email, action_type, metadata)
      VALUES (?, ?, 'invite', ?)
    `).bind(event.id, user.email, JSON.stringify({ method: 'link' })).run();
    
    return c.json({ inviteLink });
  } catch (error) {
    logger.error('Error creating invite link:', error);
    return c.json({ error: 'Failed to create invite link' }, 500);
  }
});

/**
 * GET /api/events/:slug/invite-links
 * Get all active invite links for an event (admin and collaborators)
 */
app.get('/api/events/:slug/invite-links', requireEventCapability('invite_create', 'Invite permission required'), async (c) => {
  const slug = c.req.param('slug')!;
  const user = c.get('user');
  
  try {
    // Get event
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Access is already verified by requireEventCapability middleware.
    
    // Get active invite links
    const links = await c.env.DB.prepare(`
      SELECT 
        il.*,
        u.name as creator_name
      FROM invite_links il
      LEFT JOIN users u ON il.created_by = u.email
      WHERE il.event_id = ? AND il.revoked_at IS NULL
      ORDER BY il.created_at DESC
    `).bind(event.id).all();
    
    return c.json({ inviteLinks: links.results || [] });
  } catch (error) {
    logger.error('Error fetching invite links:', error);
    return c.json({ error: 'Failed to fetch invite links' }, 500);
  }
});

/**
 * DELETE /api/events/:slug/invite-links/:token
 * Revoke an invite link (event admin only)
 */
app.delete('/api/events/:slug/invite-links/:token', requireEventCapability('invite_revoke', 'Admin collaborator role required'), async (c) => {
  const slug = c.req.param('slug')!;
  const token = c.req.param('token');
  const user = c.get('user');
  
  try {
    // Get event
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Revoke the link
    const result = await c.env.DB.prepare(`
      UPDATE invite_links 
      SET revoked_at = datetime('now')
      WHERE token = ? AND event_id = ? AND revoked_at IS NULL
    `).bind(token, event.id).run();
    
    if (result.meta.changes === 0) {
      return c.json({ error: 'Invite link not found or already revoked' }, 404);
    }
    
    // Log the action
    await c.env.DB.prepare(`
      INSERT INTO collaboration_history (event_id, user_email, action_type, metadata)
      VALUES (?, ?, 'remove', ?)
    `).bind(event.id, user.email, JSON.stringify({ method: 'link_revoked', token })).run();
    
    return c.json({ success: true });
  } catch (error) {
    logger.error('Error revoking invite link:', error);
    return c.json({ error: 'Failed to revoke invite link' }, 500);
  }
});

/**
 * POST /api/invite/:token/accept
 * Accept an invite link (requires authentication)
 */
app.post('/api/invite/:token/accept', async (c) => {
  const token = c.req.param('token');
  
  // Extract user from auth - this endpoint requires login
  const user = await extractUser(c);
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  try {
    // Get invite link and verify it's valid
    const inviteLink = await c.env.DB.prepare(`
      SELECT il.*, e.name as event_name, e.slug as event_slug
      FROM invite_links il
      JOIN events e ON il.event_id = e.id
      WHERE il.token = ? AND il.revoked_at IS NULL
    `).bind(token).first<any>();
    
    if (!inviteLink) {
      return c.json({ error: 'Invalid or revoked invite link' }, 404);
    }
    
    // Check if user is already a collaborator (case-insensitive — see
    // getCollaboratorRole() for why casing can differ).
    const existing = await c.env.DB.prepare(`
      SELECT 1 FROM event_collaborators 
      WHERE event_id = ? AND LOWER(user_email) = LOWER(?)
    `).bind(inviteLink.event_id, user.email).first();
    
    if (existing) {
      return c.json({ 
        error: 'You are already a collaborator',
        eventSlug: inviteLink.event_slug 
      }, 400);
    }
    
    // Add user as collaborator with role granted by invite link
    await c.env.DB.prepare(`
      INSERT INTO event_collaborators (event_id, user_email, role)
      VALUES (?, ?, ?)
    `).bind(inviteLink.event_id, user.email, normalizeRole(inviteLink.role) || 'uploader').run();
    
    // Update link usage stats
    await c.env.DB.prepare(`
      UPDATE invite_links 
      SET last_used_at = datetime('now'), use_count = use_count + 1
      WHERE token = ?
    `).bind(token).run();
    
    // Log the action
    await c.env.DB.prepare(`
      INSERT INTO collaboration_history (event_id, user_email, action_type, metadata)
      VALUES (?, ?, 'accept', ?)
    `).bind(inviteLink.event_id, user.email, JSON.stringify({ 
      method: 'link',
      token,
      invited_by: inviteLink.created_by 
    })).run();
    
    return c.json({ 
      success: true, 
      eventSlug: inviteLink.event_slug,
      eventName: inviteLink.event_name
    });
  } catch (error) {
    logger.error('Error accepting invite:', error);
    return c.json({ error: 'Failed to accept invite' }, 500);
  }
});

export default app;
