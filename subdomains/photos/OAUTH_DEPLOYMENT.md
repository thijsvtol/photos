# Mobile OAuth Deployment Guide

## What Was Implemented

### Frontend (Mobile App)
- ✅ Deep link handling: `photos://auth/callback`
- ✅ OAuth flow with browser authentication
- ✅ Secure token storage using Capacitor Preferences
- ✅ Automatic Bearer token injection in API requests
- ✅ AuthContext updated for mobile login flow

### Backend (Cloudflare Worker)
- ✅ New route: `/mobile-auth` for OAuth token generation
- ✅ Bearer token verification in `auth.ts`
- ✅ JWT generation with 30-day expiration
- ✅ Updated middleware to accept both Cloudflare Access cookies and Bearer tokens

## Local Development Setup

JWT_SECRET has been added to `.dev.vars`:
```
JWT_SECRET=CNavn7dPjCywA9zh/S6GE6toPqaX2ZzqywZSJ9Dh+Xo=
```

## Production Deployment

### 1. Set JWT_SECRET in Cloudflare Worker

From the photos directory, run:

```bash
cd subdomains/photos

# Set the JWT secret in production
echo "CNavn7dPjCywA9zh/S6GE6toPqaX2ZzqywZSJ9Dh+Xo=" | npx wrangler secret put JWT_SECRET
```

Or use the Cloudflare dashboard:
1. Go to Workers & Pages > photos-worker
2. Settings > Variables and Secrets
3. Add environment variable: `JWT_SECRET` = `CNavn7dPjCywA9zh/S6GE6toPqaX2ZzqywZSJ9Dh+Xo=`

### 2. Configure Cloudflare Access for /mobile-auth

The `/mobile-auth` endpoint needs to be protected by Cloudflare Access (just like the admin pages).

In your Cloudflare Zero Trust dashboard:
1. Go to Access > Applications
2. Find your photos application
3. Ensure `/mobile-auth` is protected by the same policy as `/admin/*`

Or create a new policy:
- **Application domain**: `photos.yourdomain.com`
- **Path**: `/mobile-auth`
- **Policy**: Same as your admin policy (email whitelist, etc.)

### 3. Deploy Backend

```bash
cd subdomains/photos/apps/worker
npm run deploy
```

### 4. Build and Deploy Mobile App

```bash
cd subdomains/photos/apps/web

# Build web app
npm run build

# Sync to Android
npx cap sync android

# Open in Android Studio
npx cap open android
```

Then build and install APK from Android Studio.

## Testing the OAuth Flow

### 1. Test in Mobile App

1. Open app on Android device/emulator
2. Navigate to admin section (or trigger login)
3. Click "Login" button
4. Browser should open to: `https://photos.yourdomain.com/mobile-auth?state=<random>`
5. Cloudflare Access prompts for authentication
6. After successful auth, page shows "Authentication Successful"
7. Browser redirects to: `photos://auth/callback?token=...&user=...`
8. App captures deep link and stores token
9. You should now be logged in with admin access!

### 2. Verify Token is Working

Check Android logcat for:
```
[MobileAuth] Deep link received: photos://auth/callback?...
[MobileAuth] Token stored successfully
[API] Request: GET /user/profile Full URL: https://photos.yourdomain.com/api/user/profile
[API] Authorization header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3. Test API Requests

After login, all API requests should automatically include the Bearer token:
- View events
- View photos
- Upload photos (admin only)
- Use folder sync (admin only)

## Troubleshooting

### Token Not Being Sent
- Check logcat for `[API] Authorization header:`
- Verify token is stored: `[MobileAuth] Token stored successfully`

### Authentication Fails
- Check worker logs: `npx wrangler tail`
- Verify JWT_SECRET is set in production
- Ensure `/mobile-auth` is protected by Cloudflare Access

### Deep Link Not Working
- Verify AndroidManifest.xml has intent-filter for `photos://auth`
- Check logcat for deep link events
- Try manually opening: `adb shell am start -W -a android.intent.action.VIEW -d "photos://auth/callback?token=test"`

### Token Expired
- Tokens expire after 30 days
- User needs to log in again
- App will show as logged out automatically

## Security Notes

1. **JWT_SECRET**: Keep this secret! Never commit to git. It's used to sign/verify mobile tokens.
2. **Token Expiration**: Tokens last 30 days. Adjust in `mobileAuth.ts` if needed.
3. **HTTPS Only**: Tokens are only transmitted over HTTPS.
4. **Token Storage**: Stored in Capacitor Preferences (encrypted by Android OS keychain).
5. **State Parameter**: CSRF protection - validates deep link callback matches original request.

## Files Changed

### Backend
- `apps/worker/src/auth.ts` - Added Bearer token verification
- `apps/worker/src/routes/mobileAuth.ts` - New OAuth endpoint
- `apps/worker/src/index.ts` - Registered mobileAuth routes
- `apps/worker/src/types.ts` - Added JWT_SECRET to Env interface
- `apps/worker/package.json` - Added `jose` dependency
- `.dev.vars` - Added JWT_SECRET for local dev

### Frontend
- `apps/web/src/services/mobileAuth.ts` - OAuth service with deep link handling
- `apps/web/src/contexts/AuthContext.tsx` - Mobile login flow
- `apps/web/src/api.ts` - Automatic Bearer token injection
- `apps/web/src/main.tsx` - Initialize OAuth listener
- `apps/web/capacitor.config.ts` - Deep link scheme configuration
- `apps/web/android/app/src/main/AndroidManifest.xml` - Deep link intent filter
- `apps/web/package.json` - Added `@capacitor/app` and `@capacitor/preferences`

## Next Steps

1. Deploy backend with JWT_SECRET
2. Configure Cloudflare Access for /mobile-auth
3. Build and test mobile app
4. Consider adding token revocation endpoint for security
5. Monitor token usage in worker logs
