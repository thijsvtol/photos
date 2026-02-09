import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '../types';
import { extractUser } from '../auth';

const router = new Hono<{ Bindings: Env }>();

/**
 * Mobile OAuth Authentication Page
 * 
 * GET /mobile-auth?state=<random>
 * 
 * This endpoint:
 * 1. Requires Cloudflare Access authentication (protected by CF Access)
 * 2. Extracts authenticated user from CF Access headers
 * 3. Generates a JWT OAuth token for mobile app
 * 4. Redirects to deep link: photos://auth/callback?token=...
 */
router.get('/mobile-auth', async (c) => {
  // Extract user from Cloudflare Access (should be authenticated)
  const user = await extractUser(c);
  
  if (!user) {
    return c.html(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Failed</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
            h2 { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h2>Authentication Failed</h2>
          <p>Unable to authenticate. Please ensure you're logged in via Cloudflare Access.</p>
          <p><a href="/">Go to home page</a></p>
        </body>
      </html>`,
      401
    );
  }

  // Get state parameter for CSRF protection
  const state = c.req.query('state') || '';

  try {
    // Generate OAuth token (30 days expiration)
    const token = await generateOAuthToken(c.env, {
      userId: user.id,
      email: user.email,
      name: user.name,
      expiresIn: 30 * 24 * 60 * 60 // 30 days in seconds
    });

    // Check if user is admin
    const adminEmails = c.env.ADMIN_EMAILS || '';
    const adminList = adminEmails.split(',').map(email => email.trim().toLowerCase());
    const isAdmin = adminList.includes(user.email.toLowerCase());

    // Build callback URL
    const callbackUrl = new URL('photos://auth/callback');
    callbackUrl.searchParams.set('token', token);
    callbackUrl.searchParams.set('expires', '2592000'); // 30 days in seconds
    callbackUrl.searchParams.set('state', state);
    callbackUrl.searchParams.set('user', JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: isAdmin
    }));

    console.log('Mobile auth successful for:', user.email);

    // Return HTML that redirects to deep link
    return c.html(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Successful</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="1;url=${callbackUrl.toString()}">
          <style>
            body { 
              font-family: system-ui; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px;
              text-align: center;
            }
            h2 { color: #27ae60; }
            .spinner {
              border: 4px solid #f3f3f3;
              border-top: 4px solid #27ae60;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin: 20px auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            a {
              display: inline-block;
              margin-top: 20px;
              padding: 10px 20px;
              background: #27ae60;
              color: white;
              text-decoration: none;
              border-radius: 5px;
            }
          </style>
        </head>
        <body>
          <h2>✓ Authentication Successful</h2>
          <div class="spinner"></div>
          <p>Redirecting back to app...</p>
          <p>If not redirected automatically:</p>
          <a href="${callbackUrl.toString()}">Click here to return to app</a>
        </body>
      </html>`
    );
  } catch (error) {
    console.error('Error generating mobile auth token:', error);
    return c.html(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>Error</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
            h2 { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h2>Error</h2>
          <p>Failed to generate authentication token. Please try again.</p>
          <p><a href="/mobile-auth${state ? `?state=${state}` : ''}">Try again</a></p>
        </body>
      </html>`,
      500
    );
  }
});

/**
 * Generate OAuth JWT token for mobile authentication
 */
async function generateOAuthToken(
  env: Env,
  { userId, email, name, expiresIn }: { userId: string; email: string; name?: string; expiresIn: number }
): Promise<string> {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET not configured');
  }

  const secret = new TextEncoder().encode(env.JWT_SECRET);

  const token = await new SignJWT({
    sub: userId,
    email: email,
    name: name || null,
    type: 'mobile_oauth'
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret);

  return token;
}

export default router;
