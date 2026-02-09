# OAuth Backend Implementation Guide

This document describes the backend endpoints needed to support mobile OAuth authentication.

## Required Backend Endpoints

### 1. Mobile Auth Page: `/mobile-auth`

**Purpose**: Display authentication page in browser, generate OAuth token after Cloudflare Access auth

**Flow**:
1. User opens browser to: `https://photos.thijsvtol.nl/mobile-auth?state=<random>`
2. Cloudflare Access authenticates the user (existing flow)
3. After auth, page generates OAuth token
4. Page redirects to deep link: `photos://auth/callback?token=<token>&expires=<seconds>&state=<state>&user=<json>`

**Implementation**:
```javascript
// GET /mobile-auth
export default async function handleMobileAuth(req, env) {
  // Cloudflare Access has already authenticated - user info in headers
  const userEmail = req.headers.get('cf-access-authenticated-user-email');
  const userId = req.headers.get('cf-access-authenticated-user-id'); // or derive from email
  
  if (!userEmail) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const state = new URL(req.url).searchParams.get('state');
  
  // Generate OAuth token (JWT or random string)
  const token = await generateOAuthToken(env, {
    userId,
    email: userEmail,
    expiresIn: 30 * 24 * 60 * 60 // 30 days in seconds
  });
  
  // Get user profile
  const user = await getUserProfile(env, userId);
  
  // Build callback URL
  const callbackUrl = new URL('photos://auth/callback');
  callbackUrl.searchParams.set('token', token);
  callbackUrl.searchParams.set('expires', '2592000'); // 30 days in seconds
  callbackUrl.searchParams.set('state', state);
  callbackUrl.searchParams.set('user', JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin
  }));
  
  // Return HTML that redirects to deep link
  return new Response(
    `<!DOCTYPE html>
    <html>
      <head>
        <title>Authentication Successful</title>
        <meta http-equiv="refresh" content="0;url=${callbackUrl.toString()}">
      </head>
      <body>
        <h2>Authentication Successful</h2>
        <p>Redirecting back to app...</p>
        <p>If not redirected, <a href="${callbackUrl.toString()}">click here</a></p>
      </body>
    </html>`,
    {
      headers: { 'Content-Type': 'text/html' }
    }
  );
}
```

### 2. Token Generation Function

**Purpose**: Generate secure OAuth tokens

**Implementation**:
```javascript
import { SignJWT } from 'jose';

async function generateOAuthToken(env, { userId, email, expiresIn }) {
  // Option 1: JWT Token
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  
  const token = await new SignJWT({
    sub: userId,
    email: email,
    type: 'mobile_oauth'
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret);
  
  return token;
  
  // Option 2: Random token + database storage
  // const token = crypto.randomUUID();
  // await env.DB.prepare(
  //   'INSERT INTO oauth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)'
  // ).bind(token, userId, Date.now() + (expiresIn * 1000)).run();
  // return token;
}
```

### 3. API Middleware: Bearer Token Auth

**Purpose**: Accept OAuth bearer tokens in addition to Cloudflare cookies

**Implementation**:
```javascript
async function authenticateRequest(req, env) {
  // Check for Cloudflare Access cookie (web)
  const cfUser = req.headers.get('cf-access-authenticated-user-email');
  if (cfUser) {
    return await getUserByEmail(env, cfUser);
  }
  
  // Check for Bearer token (mobile)
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    // Option 1: Verify JWT
    try {
      const secret = new TextEncoder().encode(env.JWT_SECRET);
      const { payload } = await jwtVerify(token, secret);
      return await getUserById(env, payload.sub);
    } catch (error) {
      return null;
    }
    
    // Option 2: Lookup token in database
    // const tokenRecord = await env.DB.prepare(
    //   'SELECT user_id, expires_at FROM oauth_tokens WHERE token = ?'
    // ).bind(token).first();
    // 
    // if (!tokenRecord || tokenRecord.expires_at < Date.now()) {
    //   return null;
    // }
    // 
    // return await getUserById(env, tokenRecord.user_id);
  }
  
  return null; // Not authenticated
}
```

### 4. Apply to All Protected Endpoints

**Example**:
```javascript
// Any protected endpoint
export default async function handleApiRequest(req, env) {
  const user = await authenticateRequest(req, env);
  
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Check admin permission for admin endpoints
  if (req.url.includes('/admin/') && !user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Process request...
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

## Security Considerations

1. **Token Expiration**: Set reasonable expiration (30 days recommended)
2. **HTTPS Only**: Tokens must only be transmitted over HTTPS
3. **State Parameter**: Validate state parameter to prevent CSRF
4. **Token Storage**: Mobile app stores token in Capacitor Preferences (encrypted by OS)
5. **Revocation**: Implement token revocation endpoint if using database storage

## Database Schema (if using database tokens)

```sql
CREATE TABLE oauth_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  device_info TEXT
);

CREATE INDEX idx_oauth_tokens_user ON oauth_tokens(user_id);
CREATE INDEX idx_oauth_tokens_expires ON oauth_tokens(expires_at);
```

## Testing

1. **Web Auth**: Should continue to work with Cloudflare Access cookies
2. **Mobile Auth**: 
   - Click "Login" in app
   - Browser opens to /mobile-auth
   - After Cloudflare auth, redirects to photos://auth/callback?...
   - App receives token, stores it
   - Future API requests include: `Authorization: Bearer <token>`

## Environment Variables

Add to your Cloudflare Worker:

```bash
wrangler secret put JWT_SECRET
# Enter a long random string (e.g., openssl rand -base64 32)
```
