# Configuration Guide

This guide explains how to configure the photo sharing application for your own deployment.

## Overview

The application is designed to be white-labelable and fully configurable through environment variables. No code changes are required to customize the branding, domain, or optional features.

## Required Configuration

### Worker (Backend) Configuration

Set these variables in your Cloudflare Worker environment or `wrangler.toml`:

```toml
[vars]
# Application Identity
APP_NAME = "Your App Name"
BRAND_NAME = "Your Brand"
COPYRIGHT_HOLDER = "Your Name or Organization"
APP_DOMAIN = "photos.yourdomain.com"
CONTACT_EMAIL = "contact@yourdomain.com"

# Environment (optional, defaults to production)
ENVIRONMENT = "production"  # or "development"
```

### Secrets (via Cloudflare Dashboard or CLI)

These must be set as secrets (not in `wrangler.toml`):

```bash
# Required
wrangler secret put ADMIN_EMAILS
# Enter: admin1@example.com,admin2@example.com

wrangler secret put JWT_SECRET
# Enter: A secure random string (min 32 characters)

wrangler secret put EVENT_COOKIE_SECRET
# Enter: Another secure random string (min 32 characters)

# Required for Cloudflare Access OAuth
wrangler secret put ACCESS_TEAM_DOMAIN
# Enter: yourteam.cloudflareaccess.com

wrangler secret put ACCESS_AUD
# Enter: Your Cloudflare Access Application Audience ID

# Optional: Google Analytics 4
wrangler secret put GA_MEASUREMENT_ID
# Enter: Your GA4 Measurement ID (format: G-XXXXXXXXXX)
```

### Optional Email Features (Mailgun)

For collaborator invitations and notifications:

```bash
wrangler secret put MAILGUN_API_KEY
# Enter: Your Mailgun API key

wrangler secret put MAILGUN_DOMAIN
# Enter: mg.yourdomain.com
```

**Note:** If Mailgun is not configured, email-dependent features (collaborators, invite links, upload notifications) will be automatically disabled.

### Web App (Frontend) Configuration

The frontend gets its configuration from the backend at runtime. For local development, create `.env` in `apps/web/`:

```env
# Development only - points to your local worker
VITE_API_URL=http://localhost:8787
```

In production, the web app automatically inherits configuration from the worker (no .env needed).

## Cloudflare Resources

### Required Cloudflare Resources

The application requires these Cloudflare services:

1. **Workers** - Serverless backend
2. **D1 Database** - SQLite database for metadata
3. **R2 Storage** - Object storage for photos/videos
4. **Cloudflare Access** - OAuth authentication

### Binding Configuration

In `wrangler.toml`, ensure these bindings are configured:

```toml
[[d1_databases]]
binding = "DB"
database_name = "your-photos-db"
database_id = "your-database-id"

[[r2_buckets]]
binding = "PHOTOS_BUCKET"
bucket_name = "your-photos-bucket"
```

## Feature Flags

Features are automatically enabled based on configuration:

| Feature | Requirement | Auto-Enabled |
|---------|-------------|--------------|
| Email Sending | Mailgun API key + domain | ✓ |
| Collaborators | Email sending enabled | ✓ |
| Favorites | Always available | ✓ |
| Geocoding | Always available | ✓ |
| Analytics (GA4) | GA_MEASUREMENT_ID configured | ✓ |

### Google Analytics 4 Setup

The application supports Google Analytics 4 (GA4) for tracking user interactions.

**What is tracked:**
- Page views (automatic on route changes)
- Photo views (when users open detail view)
- Photo downloads (single and bulk ZIP downloads)
- Favorite actions (add/remove favorites)

**Configuration:**

1. **Get your GA4 Measurement ID:**
   - Go to [Google Analytics](https://analytics.google.com/)
   - Create a new GA4 property or use an existing one
   - Navigate to Admin → Data Streams → Web Stream
   - Copy your Measurement ID (format: `G-XXXXXXXXXX`)

2. **Configure for Production:**
   Set as a Cloudflare Worker secret:
   ```bash
   cd apps/worker
   wrangler secret put GA_MEASUREMENT_ID
   # Enter: G-XXXXXXXXXX
   ```

3. **Configure for Development:**
   Add to `apps/web/.env` (you may need to create this file from `.env.example`):
   ```bash
   VITE_GA_MEASUREMENT_ID="G-XXXXXXXXXX"
   ```
   
   Or use the placeholder ID for testing:
   ```bash
   VITE_GA_MEASUREMENT_ID="G-PLACEHOLDER"
   ```

4. **Disable Analytics:**
   To disable tracking:
   - Don't set the `GA_MEASUREMENT_ID` secret (or delete it with `wrangler secret delete GA_MEASUREMENT_ID`)
   - For development, remove `VITE_GA_MEASUREMENT_ID` from `.env` or set it to `G-PLACEHOLDER`

**Privacy Considerations:**
- IP anonymization is enabled by default
- No personally identifiable information (PII) is sent to GA4
- Consider adding a cookie consent banner if required by your jurisdiction (GDPR, CCPA, etc.)

**Verification:**
- After deploying, visit your site and navigate through pages
- Open Google Analytics → Reports → Realtime
- You should see your activity appear within ~30 seconds

- `APP_DOMAIN` - Primary domain without protocol (e.g., "photos.example.com")
- Used for CORS, email links, SEO metadata, and API URLs

### Contact Information

- `CONTACT_EMAIL` - Displayed in footer and used for system emails

## Environment Variables Reference

### Worker Environment Variables

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `APP_NAME` | String | Yes | Full application name |
| `BRAND_NAME` | String | Yes | Brand name for UI |
| `COPYRIGHT_HOLDER` | String | Yes | Copyright holder name |
| `APP_DOMAIN` | String | Yes | Domain without protocol |
| `CONTACT_EMAIL` | String | Yes | Contact email address |
| `ENVIRONMENT` | String | No | `production` or `development` |
| `ADMIN_EMAILS` | Secret | Yes | Comma-separated admin emails |
| `JWT_SECRET` | Secret | Yes | JWT signing secret (32+ chars) |
| `EVENT_COOKIE_SECRET` | Secret | Yes | Cookie signing secret (32+ chars) |
| `ACCESS_TEAM_DOMAIN` | Secret | Yes | Cloudflare Access team domain |
| `ACCESS_AUD` | Secret | Yes | Cloudflare Access audience ID |
| `GA_MEASUREMENT_ID` | Secret | No | Google Analytics 4 Measurement ID |
| `MAILGUN_API_KEY` | Secret | No | Mailgun API key for emails |
| `MAILGUN_DOMAIN` | Secret | No | Mailgun sending domain |

### Web App Environment Variables (Development)

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `VITE_API_URL` | String | Dev only | Worker URL for local development |
| `VITE_GA_MEASUREMENT_ID` | String | No | Google Analytics 4 Measurement ID |

## Quick Start Configuration

### 1. Clone and Install

```bash
git clone <repository-url>
npm install
```

### 2. Configure Worker

Edit `apps/worker/wrangler.toml`:

```toml
[vars]
APP_NAME = "My Photo Gallery"
BRAND_NAME = "My Gallery"
COPYRIGHT_HOLDER = "Your Name"
APP_DOMAIN = "photos.yourdomain.com"
CONTACT_EMAIL = "hello@yourdomain.com"
```

### 3. Set Secrets

```bash
cd apps/worker
wrangler secret put ADMIN_EMAILS
wrangler secret put JWT_SECRET
wrangler secret put EVENT_COOKIE_SECRET
wrangler secret put ACCESS_TEAM_DOMAIN
wrangler secret put ACCESS_AUD
```

### 4. Create D1 Database

```bash
wrangler d1 create your-photos-db
# Copy the database_id to wrangler.toml
```

### 5. Run Migrations

```bash
wrangler d1 migrations apply your-photos-db --remote
```

### 6. Create R2 Bucket

```bash
wrangler r2 bucket create your-photos-bucket
```

### 7. Deploy

```bash
# Deploy worker
cd apps/worker
npm run deploy

# Build and deploy web app
cd ../web
npm run build
# Deploy dist/ to your hosting (Pages, Netlify, etc.)
```

## Development Setup

For local development:

```bash
# Terminal 1: Start worker
cd apps/worker
npm run dev

# Terminal 2: Start web app
cd apps/web
npm run dev
```

The web app will be available at `http://localhost:5173` and will proxy API requests to the worker at `http://localhost:8787`.

## Validation

After deployment, verify your configuration:

1. Visit `https://your-domain.com` - should show your brand name
2. Check footer copyright - should show your copyright holder
3. Try creating an event (requires admin login)
4. Check feature availability at worker endpoint `GET /api/features` (if implemented)

## Troubleshooting

### "Feature not available" errors

- Check Mailgun configuration if collaborator features don't work
- Verify all required secrets are set with `wrangler secret list`

### CORS errors

- Ensure `APP_DOMAIN` matches your actual domain
- Check Cloudflare Access is correctly configured

### Authentication issues

- Verify `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are correct
- Check admin emails are correctly set in `ADMIN_EMAILS`
- Ensure JWT secrets are properly set

### Email not sending

- Verify Mailgun API key and domain are correct
- Check Mailgun logs for delivery issues
- Confirm sending domain is verified in Mailgun

## Security Best Practices

1. **Use strong secrets** - Generate cryptographically secure random strings
2. **Rotate secrets regularly** - Update JWT and cookie secrets periodically
3. **Limit admin access** - Only add necessary emails to `ADMIN_EMAILS`
4. **Enable Cloudflare Access** - Don't rely solely on application authentication
5. **Use HTTPS** - Always deploy with SSL/TLS enabled
6. **Review Cloudflare settings** - Enable DDoS protection and WAF rules

## Next Steps

- Read [FEATURES.md](./FEATURES.md) to understand available features
- Review [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details
- Check [API documentation](./api-reference.md) for API documentation
- See [CONTRIBUTING.md](./CONTRIBUTING.md) to contribute
