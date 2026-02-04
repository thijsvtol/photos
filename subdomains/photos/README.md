# Photos Subdomain - photos.thijsvtol.nl

A full-stack photo gallery application built with React + Vite + Tailwind (frontend) and Cloudflare Worker (backend), with D1 database and R2 storage.

## Features

### Public Features
- 📋 Event list page with all available photo galleries
- 🔐 Per-event password protection
- 🖼️ Gallery view with watermarked preview images
- 📅 Time-based photo sorting by EXIF capture time
- 🔍 Date range filtering
- 📷 Direct photo links with password protection (`/p/:eventSlug/:photoId`)
- ⬇️ Multiple download options:
  - Original full-resolution JPEG
  - Instagram-ready (max 1080px)
  - Batch download selected photos as ZIP (max 50)
- ⭐ Local favorites/selection (stored in browser)

### Admin Features
- 🎯 Event creation with auto-generated slugs
- 📤 Drag & drop photo upload
- 🔄 Persistent upload queue with IndexedDB (survives page reloads)
- 📦 Multipart upload to R2 for large files
- 📊 EXIF metadata extraction (capture time, dimensions)
- 🏷️ Automatic event date inference from photos
- 💧 Image processing utilities (watermarking ready for implementation)

## Architecture

```
subdomains/photos/
├── apps/
│   ├── web/           # React + Vite + Tailwind frontend
│   └── worker/        # Cloudflare Worker backend (TypeScript + Hono)
├── migrations/        # D1 database migrations
├── wrangler.toml      # Worker configuration
└── README.md          # This file
```

## Prerequisites

- Node.js 18+ and npm
- Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)

## Local Development Setup

### 1. Install Dependencies

```bash
# Install worker dependencies
cd subdomains/photos/apps/worker
npm install

# Install web dependencies
cd subdomains/photos/apps/web
npm install
```

### 2. Set Up D1 Database

```bash
cd subdomains/photos

# Create D1 database (if not already created)
wrangler d1 create photos-db

# The command above will output a database_id - copy it and add it to wrangler.toml
# Update the database_id in wrangler.toml under [[d1_databases]]

# Run migrations locally (for development)
wrangler d1 execute photos-db --local --file=./migrations/001_init.sql

# Or run migrations on remote database (for production)
wrangler d1 execute photos-db --file=./migrations/001_init.sql
```

### 3. Set Up R2 Bucket

For **local development**, you don't need to create an R2 bucket - Wrangler will automatically simulate R2 storage locally.

For **production deployment**, you need to:
1. Enable R2 in your Cloudflare Dashboard (Settings → R2)
2. Create the bucket:
```bash
wrangler r2 bucket create photos-storage
```

### 4. Configure Local Secrets

For local development, create a `.dev.vars` file in the same directory as `wrangler.toml`:

```bash
cd subdomains/photos

# Create .dev.vars file with your secrets
cat > .dev.vars << 'EOF'
# Required: Secret for signing event session cookies
EVENT_COOKIE_SECRET=dev-secret-change-in-production-123456789

# Optional: Shared secret for admin API in development
# ADMIN_SHARED_SECRET=your-admin-secret
EOF
```

> **Note**: The `.dev.vars` file should be gitignored and never committed to version control.

### 5. Start Development Servers

**Terminal 1 - Worker:**
```bash
cd subdomains/photos
npm --prefix apps/worker run dev
# Worker runs on http://localhost:8787
```

**Terminal 2 - Web App:**
```bash
cd subdomains/photos/apps/web
npm run dev
# Web app runs on http://localhost:3000
# API requests are proxied to the worker
```

### 6. Access the Application

- Public site: http://localhost:3000
- Admin dashboard: http://localhost:3000/admin
- Worker API: http://localhost:8787

## Production Deployment

### 1. Create Production D1 Database

```bash
cd subdomains/photos

# Create production database
wrangler d1 create photos-db

# Copy the database_id from output and update wrangler.toml

# Run migrations
wrangler d1 execute photos-db --file=./migrations/001_init.sql
```

### 2. Create R2 Bucket

```bash
wrangler r2 bucket create photos-storage
```

### 3. Set Production Secrets

```bash
cd subdomains/photos/apps/worker

# Set cookie secret
wrangler secret put EVENT_COOKIE_SECRET --env production
# Enter a strong random string

# Admin access is handled by Cloudflare Access (see below)
```

### 4. Deploy Worker

```bash
cd subdomains/photos/apps/worker
npm run deploy
```

### 5. Deploy Frontend to Cloudflare Pages

```bash
cd subdomains/photos/apps/web
npm run build
# Output is in dist/

# Deploy to Cloudflare Pages
# 1. Go to Cloudflare Dashboard > Pages
# 2. Create a new project
# 3. Connect to your repository
# 4. Configure build:
#    - Build command: cd subdomains/photos/apps/web && npm install && npm run build
#    - Build output directory: subdomains/photos/apps/web/dist
# 5. Set environment variable: VITE_API_URL to your worker URL
```

### 6. Configure Domain and Routes

1. **Update wrangler.toml** with your domain:
   ```toml
   routes = [
     { pattern = "photos.thijsvtol.nl/api/*", zone_name = "thijsvtol.nl" },
     { pattern = "photos.thijsvtol.nl/media/*", zone_name = "thijsvtol.nl" }
   ]
   ```

2. **Configure Cloudflare Pages** to serve from `photos.thijsvtol.nl`

3. **Important**: The `apps/web/public/_routes.json` file disables Pages Functions (excludes all routes) so that Cloudflare Pages serves only static assets for the React SPA. The standalone Worker, deployed separately via wrangler, handles `/api/*` and `/media/*` routes through the zone-level routes configured in `wrangler.toml`. This file is automatically included in the build output.

### 7. Set Up Cloudflare Access (Admin Protection)

1. Go to Cloudflare Dashboard > Zero Trust > Access
2. Create an Application:
   - Name: "Photos Admin"
   - Subdomain: photos.thijsvtol.nl
   - Path: `/admin*`
3. Add a Policy:
   - Name: "Admin Access"
   - Action: Allow
   - Include: Emails ending in your domain, or specific email addresses
4. The worker checks for `X-Admin-Access: 1` header
5. Cloudflare Access automatically adds this header for authenticated users

## Database Schema

### Events Table
- `id`: Primary key (auto-increment)
- `slug`: Unique event identifier (URL-friendly)
- `name`: Event name
- `password_salt`: Random salt for password hashing
- `password_hash`: SHA-256 hash of salted password
- `inferred_date`: Earliest photo capture date (YYYY-MM-DD)
- `created_at`: Event creation timestamp

### Photos Table
- `id`: ULID/UUID string
- `event_id`: Foreign key to events
- `original_filename`: Original file name
- `capture_time`: EXIF capture timestamp (ISO 8601)
- `uploaded_at`: Upload timestamp
- `width`: Image width in pixels
- `height`: Image height in pixels

## R2 Storage Layout

```
photos-storage/
├── original/
│   └── {eventSlug}/
│       └── {photoId}.jpg
├── preview/
│   └── {eventSlug}/
│       └── {photoId}.jpg  (watermarked, max 2000px)
└── ig/
    └── {eventSlug}/
        └── {photoId}.jpg  (watermarked, max 1080px)
```

## API Endpoints

### Public API

- `GET /api/events` - List all events
- `GET /api/events/:slug` - Get event details
- `POST /api/events/:slug/login` - Authenticate to event
- `GET /api/events/:slug/photos` - List photos (requires auth)
- `GET /api/events/:slug/photos/:photoId` - Get photo details (requires auth)
- `POST /api/events/:slug/zip` - Request batch download (requires auth)

### Media Endpoints (Password Gated)

- `GET /media/:slug/preview/:photoId.jpg` - Watermarked preview
- `GET /media/:slug/ig/:photoId.jpg` - Instagram-ready
- `GET /media/:slug/original/:photoId.jpg` - Full resolution

### Admin API

- `POST /api/admin/events` - Create event
- `POST /api/admin/events/:slug/uploads/start` - Start multipart upload
- `POST /api/admin/events/:slug/uploads/:photoId/parts` - Get part upload URL
- `POST /api/admin/events/:slug/uploads/:photoId/complete` - Complete upload

## Environment Variables & Secrets

### Worker Secrets (via `wrangler secret put`)
- `EVENT_COOKIE_SECRET`: Secret for signing session cookies (required)
- `ADMIN_SHARED_SECRET`: Optional shared secret for admin API in development

### Worker Environment Variables
- `ENVIRONMENT`: Set to "development" or "production"

## Security Features

- **Password Protection**: SHA-256 hashed with random salt
- **Session Cookies**: HttpOnly, Secure, SameSite=Lax, session-only (no expiry)
- **Admin Protection**: Cloudflare Access + header validation
- **CORS**: Configured for same-origin requests
- **Input Validation**: All API endpoints validate inputs

## Known Limitations & Future Enhancements

1. **Watermarking**: Image processing utilities implemented, ready for integration with actual image manipulation service
2. **Derivative Generation**: Preview and IG versions need to be generated (requires image processing service integration)
3. **Thumbnail Optimization**: Could add smaller thumbnails for gallery grid

## Troubleshooting

### Worker not connecting to D1
- Ensure database_id in wrangler.toml matches your D1 database
- Check that migrations have been run
- Verify bindings in wrangler dev output

### Upload failing
- Check browser console for CORS errors
- Verify R2 bucket exists and is bound correctly
- Check that files are valid JPEG images
- Ensure multipart upload is supported by R2 binding

### Admin access denied
- In development: Check ADMIN_SHARED_SECRET is set correctly
- In production: Verify Cloudflare Access is configured
- Ensure `X-Admin-Access: 1` header is being sent

### Photos not showing
- Verify event password is correct
- Check browser cookies are enabled
- Look for authentication errors in browser console
- Ensure photos exist in R2 storage

## Development Tips

- Use `wrangler tail` to see Worker logs in real-time
- Check browser IndexedDB (Application tab in DevTools) to see upload queue state
- Use browser Network tab to debug API calls
- Test with various JPEG files to ensure EXIF extraction works

## License

Proprietary - Thijs van Tol
