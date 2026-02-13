import { Hono } from 'hono';
import type { Env, InviteCollaboratorRequest, CollaboratorWithUser, User } from '../types';
import { requireAdmin, extractUser } from '../auth';
import { requireFeature } from '../features';
import { getConfig } from '../config';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Require collaborators feature to be enabled for all routes
app.use('/*', requireFeature('enableCollaborators'));

/**
 * GET /api/events/:slug/collaborators
 * Get all collaborators for an event
 * Public endpoint - allows anyone who can view the event to see collaborators
 */
app.get('/api/events/:slug/collaborators', async (c) => {
  const slug = c.req.param('slug');
  
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
        u.email,
        u.name
      FROM event_collaborators ec
      LEFT JOIN users u ON ec.user_email = u.email
      WHERE ec.event_id = ?
      ORDER BY ec.invited_at DESC
    `).bind(event.id).all<CollaboratorWithUser>();
    
    return c.json({ collaborators: collaborators.results || [] });
  } catch (error) {
    console.error('Error fetching collaborators:', error);
    return c.json({ error: 'Failed to fetch collaborators' }, 500);
  }
});

/**
 * POST /api/events/:slug/collaborators
 * Invite a user to collaborate on an event (admin only)
 */
app.post('/api/events/:slug/collaborators', requireAdmin, async (c) => {
  const slug = c.req.param('slug');
  console.log('[Invite Collaborator] Starting for event:', slug);
  
  const body = await c.req.json<InviteCollaboratorRequest>();
  console.log('[Invite Collaborator] Request body:', body);
  
  if (!body.email || !body.email.includes('@')) {
    console.log('[Invite Collaborator] Invalid email:', body.email);
    return c.json({ error: 'Valid email is required' }, 400);
  }
  
  const adminUser = await extractUser(c);
  if (!adminUser) {
    console.log('[Invite Collaborator] No admin user found');
    return c.json({ error: 'Unauthorized' }, 401);
  }
  console.log('[Invite Collaborator] Admin user:', adminUser.email);
  
  try {
    // Get event ID from slug
    const event = await c.env.DB.prepare(
      'SELECT id, name FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number; name: string }>();
    
    if (!event) {
      console.log('[Invite Collaborator] Event not found:', slug);
      return c.json({ error: 'Event not found' }, 404);
    }
    console.log('[Invite Collaborator] Event found:', event.id, event.name);
    
    // Check if user exists, create if not
    let user = await c.env.DB.prepare(
      'SELECT email, name FROM users WHERE LOWER(email) = LOWER(?)'
    ).bind(body.email).first<{ email: string; name: string | null }>();
    
    if (!user) {
      console.log('[Invite Collaborator] User not found, creating new user');
      // Create a placeholder user (they'll be fully created when they first log in)
      const createResult = await c.env.DB.prepare(
        'INSERT INTO users (email, name) VALUES (?, ?)'
      ).bind(body.email, null).run();
      console.log('[Invite Collaborator] User creation result:', createResult.success);
      
      user = { email: body.email, name: null };
    } else {
      console.log('[Invite Collaborator] User exists:', user.email);
    }
    
    // Check if collaborator relationship already exists
    const existing = await c.env.DB.prepare(
      'SELECT 1 FROM event_collaborators WHERE event_id = ? AND user_email = ?'
    ).bind(event.id, user.email).first();
    
    if (existing) {
      console.log('[Invite Collaborator] Collaborator already exists');
      return c.json({ error: 'User is already a collaborator' }, 400);
    }
    
    // Create collaborator relationship
    console.log('[Invite Collaborator] Creating collaborator relationship');
    const insertResult = await c.env.DB.prepare(`
      INSERT INTO event_collaborators (event_id, user_email)
      VALUES (?, ?)
    `).bind(event.id, user.email).run();
    console.log('[Invite Collaborator] Insert result:', insertResult.success, insertResult.meta);
    
    if (!insertResult.success) {
      console.error('[Invite Collaborator] Failed to insert collaborator');
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
    console.log('[Invite Collaborator] Sending invitation email to:', body.email);
    await sendInvitationEmail(c.env, {
      to: body.email,
      eventName: event.name,
      eventSlug: slug,
      invitedBy: adminUser.name || adminUser.email
    });
    
    console.log('[Invite Collaborator] Successfully completed');
    return c.json({ 
      message: 'Collaborator invited successfully',
      collaborator: {
        user_email: user.email,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('[Invite Collaborator] Error:', error);
    return c.json({ error: 'Failed to invite collaborator' }, 500);
  }
});

/**
 * DELETE /api/events/:slug/collaborators/:userEmail
 * Remove a collaborator from an event (admin only)
 */
app.delete('/api/events/:slug/collaborators/:userEmail', requireAdmin, async (c) => {
  const slug = c.req.param('slug');
  const userEmail = c.req.param('userEmail');
  
  try {
    // Get event ID from slug
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Delete collaborator relationship
    const result = await c.env.DB.prepare(
      'DELETE FROM event_collaborators WHERE event_id = ? AND user_email = ?'
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
    console.error('Error removing collaborator:', error);
    return c.json({ error: 'Failed to remove collaborator' }, 500);
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
    console.error('Error fetching collaborations:', error);
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
    console.error('Error searching users:', error);
    return c.json({ error: 'Failed to search users' }, 500);
  }
});

/**
 * GET /api/events/:slug/collaboration-history
 * Get collaboration history for an event (admin only)
 */
app.get('/api/events/:slug/collaboration-history', requireAdmin, async (c) => {
  const slug = c.req.param('slug');
  
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
    console.error('Error fetching collaboration history:', error);
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
    console.error('[Collaboration History] Error logging action:', error);
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
    console.warn('Mailgun not configured (missing MAILGUN_API_KEY or MAILGUN_DOMAIN), skipping invitation email');
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
      console.error('[Mailgun] Failed to send email:', response.status, errorText);
    } else {
      const result: any = await response.json();
      console.log('[Mailgun] Email sent successfully to:', params.to, 'ID:', result.id);
    }
  } catch (error: any) {
    console.error('[Mailgun] Error sending invitation email:', error);
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
    console.warn('Mailgun not configured (missing MAILGUN_API_KEY or MAILGUN_DOMAIN), skipping upload notification');
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
      console.error('[Mailgun] Failed to send upload notification:', response.status, errorText);
    } else {
      const result: any = await response.json();
      console.log('[Mailgun] Upload notification sent to:', params.adminEmail, 'ID:', result.id);
    }
  } catch (error: any) {
    console.error('[Mailgun] Error sending upload notification:', error);
    // Don't fail the request if email fails
  }
}

/**
 * POST /api/events/:slug/invite-links
 * Create a shareable invite link for an event (admin only)
 */
app.post('/api/events/:slug/invite-links', requireAdmin, async (c) => {
  const slug = c.req.param('slug');
  const user = c.get('user');
  
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
      INSERT INTO invite_links (token, event_id, created_by)
      VALUES (?, ?, ?)
    `).bind(token, event.id, user.email).run();
    
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
    console.error('Error creating invite link:', error);
    return c.json({ error: 'Failed to create invite link' }, 500);
  }
});

/**
 * GET /api/events/:slug/invite-links
 * Get all active invite links for an event (admin only)
 */
app.get('/api/events/:slug/invite-links', requireAdmin, async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get event
    const event = await c.env.DB.prepare(
      'SELECT id FROM events WHERE slug = ?'
    ).bind(slug).first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
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
    console.error('Error fetching invite links:', error);
    return c.json({ error: 'Failed to fetch invite links' }, 500);
  }
});

/**
 * DELETE /api/events/:slug/invite-links/:token
 * Revoke an invite link (admin only)
 */
app.delete('/api/events/:slug/invite-links/:token', requireAdmin, async (c) => {
  const slug = c.req.param('slug');
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
    console.error('Error revoking invite link:', error);
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
    
    // Check if user is already a collaborator
    const existing = await c.env.DB.prepare(`
      SELECT 1 FROM event_collaborators 
      WHERE event_id = ? AND user_email = ?
    `).bind(inviteLink.event_id, user.email).first();
    
    if (existing) {
      return c.json({ 
        error: 'You are already a collaborator',
        eventSlug: inviteLink.event_slug 
      }, 400);
    }
    
    // Add user as collaborator
    await c.env.DB.prepare(`
      INSERT INTO event_collaborators (event_id, user_email)
      VALUES (?, ?)
    `).bind(inviteLink.event_id, user.email).run();
    
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
    console.error('Error accepting invite:', error);
    return c.json({ error: 'Failed to accept invite' }, 500);
  }
});

export default app;
