# Photo Sharing Application

A full-stack, white-label photo gallery application built with React + Vite + Tailwind (frontend) and Cloudflare Workers (backend), with D1 database and R2 storage.

> **Open Source & Self-Hosted**: Deploy your own branded photo sharing platform with complete control over your data.

## Documentation

- **[Configuration Guide](docs/configuration.md)** - Complete setup and deployment instructions
- **[API Reference](docs/api-reference.md)** - REST API endpoint documentation
- **[Architecture](docs/architecture.md)** - Technical architecture and design
- **[Features](docs/features.md)** - Feature descriptions and usage examples
- **[Image Processing](docs/image-processing.md)** - Preview/derivative generation and current limitations
- **[Contact Form](docs/contact-form.md)** - Configuring the landing page contact form
- **[Mobile Guide](docs/mobile-guide.md)** - Building and running the Android app
- **[Mobile OAuth Setup](docs/mobile-oauth.md)** - Cloudflare Access OAuth for the mobile app
- **[Android Deployment](docs/android-deployment.md)** - Google Play Store release process
- **[Contributing](docs/contributing.md)** - Contribution guidelines and development workflow

## 🏗️ Architecture

### Frontend (`apps/web`)

- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite 8
- **Styling**: Tailwind CSS 4
- **Routing**: React Router v7
- **State**: React hooks + Context API
- **Storage**: IndexedDB (via Dexie) for upload queue persistence
- **Maps**: Leaflet + React-Leaflet (with marker clustering)
- **Image Processing**: Client-side Canvas API for preview/blur-placeholder generation, RAW decoding (`libraw-wasm`), and in-browser image editing (`react-filerobot-image-editor` + `react-konva`)
- **Video**: Client-side trimming/processing via `@ffmpeg/ffmpeg` (single-threaded, no COOP/COEP required)
- **Mobile**: Capacitor 8 (Android native wrapper; iOS not currently packaged)

### Backend (`apps/worker`)

- **Runtime**: Cloudflare Workers
- **Framework**: Hono 4
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (S3-compatible)
- **Auth**: Cloudflare Access (web) + JWT bearer tokens (mobile), HTTP-only session cookies for per-event passwords
- **Image Processing**: Preview/blur-placeholder generation happens client-side at upload time; the worker only streams original/preview files from R2 and does **not** apply server-side watermarking or resizing (see [docs/image-processing.md](docs/image-processing.md))

## ✨ Features

### Public Features

- 🏠 **Landing Page**: Featured photo slideshow with auto-rotation
- 📋 **Event List**: Browse all public events with preview images, tags, and locations
- 🔐 **Password Protection**: Optional per-event password protection
- 🖼️ **Gallery View**: Masonry layout with responsive cards preserving aspect ratios
- 📅 **Photo Sorting**: By date (asc/desc), filename (asc/desc), or featured status
- 🏷️ **Tag Filtering**: Browse events by tags (e.g., "Schaatsen", "Skeeleren")
- 🌍 **City Filtering**: Filter events by location/city
- 📷 **Direct Photo Links**: Share individual photos with `/p/:eventSlug/:photoId`
- 🎯 **Photo Navigation**: Seamless browsing without page reload (pushState)
- ⌨️ **Keyboard Navigation**: Arrow keys, Escape to close, slideshow mode
- 📱 **Mobile-Friendly**: Touch gestures, native share API, and responsive design
- 📸 **EXIF Metadata**: Full camera, lens, and settings display
- 🗺️ **Map View**: Browse all photos with GPS coordinates on interactive map (marker clustering)
- 🕒 **Timeline View**: Chronological, infinite-scroll view across all accessible events
- 🎥 **Video Support**: Upload and play `.mp4`/`.mov` videos alongside photos
- 📡 **Chromecast**: Cast photos/videos to a TV from the web app
- 📶 **Offline-Aware**: Offline banner + pull-to-refresh, with network status detection on native
- ⬇️ **Download Options**:
  - Original full-resolution file
  - Preview (1920px @ 85% quality JPEG)
  - Batch download selected photos as ZIP (max 50)
- ⭐ **Favorites**: Add photos to favorites, view in dedicated favorites page
- 🎨 **Progressive Images**: Blur placeholder → full image transition
- 🔄 **Smart Caching**: Preview images cached by browser
- 📄 **Photo Usage & Privacy Pages**: Dedicated `/usage` (rights/licensing) and `/privacy` pages
- 🔗 **Invite Links**: Join an event as a collaborator via a shareable, expirable link (`/invite/:token`)

### Admin Features

#### Dashboard (`/admin`)

- 📊 **Analytics Cards**: Total events, photos, storage usage, favorites
- 📈 **Public/Private Split**: Track event visibility at a glance
- 🎯 **Event Management**: Create, edit, and delete events
- 🏷️ **Tag System**: Assign tags to events from edit modal
- 🗑️ **Safe Deletion**: Confirmation modals for all destructive actions
- 📝 **Event Details**: Edit name, description, password, and tags
- 🔗 **Quick Access**: Direct links to upload, photo manager, and public gallery

#### Photo Upload (`/admin/events/:slug/upload`)

- 📤 **Drag & Drop**: Upload multiple photos and videos at once
- 🔄 **Persistent Queue**: IndexedDB-backed upload queue survives page reloads
- 📦 **Multipart Upload**: Efficient large file uploads (5MB chunks) to R2
- 🚦 **Concurrency Capping**: Limits concurrent uploads to avoid exhausting the browser's connection pool on large batches
- 📊 **EXIF Extraction**: Automatic metadata extraction (camera, lens, settings, GPS)
- 🖼️ **RAW Photo Support**: Client-side RAW decoding (`.cr2`, `.nef`, `.arw`, `.dng`, etc. via `libraw-wasm`) with a generated JPEG preview, while the original RAW file is preserved
- 🖼️ **Client-Side Preview Generation**: Creates 1920px previews in browser (85% quality)
- 🎨 **Blur Placeholders**: Generates tiny blurred placeholders for progressive loading
- 📈 **Event Analytics**:
  - Photo count and GPS coverage
  - Top 5 favorited photos with thumbnails
  - Camera models used
  - Featured photo count
- 🗺️ **GPS Location Setter**: Interactive map to view/verify photo locations
- 🖼️ **Photo Manager Link**: Quick access to manage all photos

#### Photo Manager (`/admin/events/:slug/photos`)

- 🎯 **Grid View**: Visual overview of all event photos
- ☑️ **Bulk Selection**: Checkbox selection with Select All/Deselect All
- ⭐ **Featured Toggle**: Mark photos as featured (shows on landing page)
- 🗑️ **Bulk Delete**: Delete multiple selected photos at once
- 👁️ **Preview Modal**: Preview photo before deleting
- 🏷️ **Featured Badge**: Visual indicator for featured photos
- 💝 **Favorite Count**: See how many users favorited each photo
- ✂️ **Image Editing**: Crop, rotate, and adjust curves/levels in-browser (Filerobot-based editor); native Android uses the same editor with same-origin blob fetching to avoid canvas tainting
- 🎬 **Video Editing**: Trim, crop, and adjust playback speed client-side via FFmpeg WASM
- 📤 **Replace Original/Preview**: Save edits back to R2 without re-uploading from scratch

#### Tag Manager (`/admin/tags`)

- 🏷️ **Tag CRUD**: Create, edit, and delete tags
- 📊 **Usage Stats**: See how many events use each tag
- 🔗 **Auto-Slugs**: Automatic URL-friendly slug generation
- 📝 **Descriptions**: Add descriptions to tags for context
- ⚠️ **Safe Deletion**: Warns before deleting tags in use

#### Collaborator System

- 👥 **Invite Users**: Invite collaborators by email to upload photos to specific events
- 🔗 **Shareable Invite Links**: Generate expirable, revocable links so people can self-join as collaborators without an email invite
- 📧 **Email Notifications**: Automatic invitation emails with event details (requires Mailgun)
- ⚡ **Upload Permissions**: Collaborators can upload photos/videos without admin access
- 🧑‍🤝‍🧑 **Collaborator Roles**: Fine-grained capabilities (e.g. invite, remove collaborator, change role) rather than a single flat role
- 📊 **Status Tracking**: See pending, accepted, or declined invitations
- 🕓 **Collaboration History**: Audit log of collaborator/invite actions per event
- 🔒 **Secure Access**: Uses Cloudflare Access authentication (web) and JWT bearer tokens (mobile)
- 🗑️ **Easy Management**: Add or remove collaborators anytime from admin dashboard
- 📚 **Documentation**: See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/features.md](docs/features.md#collaboration-system) for a detailed guide

#### Technical Features

- 🔐 **Cloudflare Access**: Secure admin authentication
- 🔒 **Admin-Only APIs**: X-Admin-Access header validation
- 🎨 **Responsive Design**: Works on desktop, tablet, and mobile
- ✅ **Real-time Feedback**: Success/error messages for all actions
- 🚀 **Optimized Performance**: Efficient queries and caching

## Architecture

```text
.
├── apps/
│   ├── web/           # React + Vite + Tailwind frontend
│   ├── worker/        # Cloudflare Worker backend (TypeScript + Hono)
│   └── android/       # Android native app (Capacitor)
├── migrations/        # D1 database migrations
├── wrangler.toml      # Worker configuration
└── README.md          # This file
```

## Prerequisites

- Node.js 18+ and npm
- Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)

## Local Development Setup

### Quick Start with Setup Script

```bash
./scripts/setup-dev.sh
```

This will install all dependencies and show you the next steps.

### Manual Setup

### 1. Install Dependencies

```bash
# Install worker dependencies
cd apps/worker
npm install

# Install web dependencies
cd ../web
npm install
```

### 2. Set Up D1 Database (Local)

```bash
# Create local D1 database
wrangler d1 create photos-db-local

# Run ALL migrations
for file in ./migrations/*.sql; do wrangler d1 execute photos-db-local --local --file="$file"; done
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
npm --prefix apps/worker run dev
# Worker runs on http://localhost:8787
```

**Terminal 2 - Web App:**

```bash
cd apps/web
npm run dev
# Web app runs on http://localhost:5173
# API requests are proxied to the worker
```

### 6. Access the Application

- **Public site**: <http://localhost:5173>
- **Admin dashboard**: <http://localhost:5173/admin>
- **Worker API**: <http://localhost:8787> (direct access)

---

## Running the Application

### Local Development

Once setup is complete, you need **two terminal windows** running simultaneously:

**Terminal 1 - Worker (Backend API)**:

```bash
cd apps/worker
npm run dev
```

- Runs on <http://localhost:8787>
- Handles all `/api/*` and `/media/*` requests
- Auto-reloads on code changes
- Access to local D1 and simulated R2 storage

**Terminal 2 - Web App (Frontend)**:

```bash
cd apps/web
npm run dev
```

- Runs on <http://localhost:5173>
- Proxies `/api` and `/media` requests to the worker on port 8787
- Hot module replacement (instant updates)
- React DevTools compatible

**Using the Admin Panel Locally**:

In development, admin access uses a shared secret:

1. Set the `ADMIN_SHARED_SECRET` in `.dev.vars` (e.g., `dev-secret-123`)
2. Add `X-Admin-Secret: dev-secret-123` header to requests
3. Or use browser extension to add the header
4. The admin pages will automatically include this header

**Development Workflow**:

1. Start both terminals (worker + web)
2. Create an event at <http://localhost:5173/admin>
3. Upload photos to the event
4. Mark some photos as featured
5. View the public gallery and landing page

### Testing Production Build Locally

**Build the frontend**:

```bash
cd apps/web
npm run build
npm run preview  # Serves the production build
```

**Test the worker locally**:

```bash
cd apps/worker
npm run build
wrangler dev  # Uses production-like environment
```

## Production Deployment

### 1. Create Production D1 Database

```bash
# Create production database
wrangler d1 create photos-db

# Copy the database_id from output and update wrangler.toml
# Update both [[d1_databases]] and [[env.production.d1_databases]] with the same database_id

# Run ALL migrations on production database, in order (there are 21 files in migrations/ as of this writing)
for file in ./migrations/*.sql; do wrangler d1 execute photos-db --remote --file="$file"; done

# Verify migrations were successful:
wrangler d1 execute photos-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
# Should show: events, photos, tags, event_tags, event_collaborators, collaboration_history,
# invite_links, and other supporting tables
```

### 2. Create R2 Bucket

```bash
wrangler r2 bucket create photos-storage
```

### 3. Set Production Secrets

```bash
# Set cookie secret
wrangler secret put EVENT_COOKIE_SECRET
# Enter a strong random string (use: openssl rand -base64 32)

# Admin access is handled by Cloudflare Access (see below)
```

### 4. Deploy Worker

```bash
cd apps/worker
npm install
cd ../..
npx wrangler deploy --env production
```

### 5. Deploy Frontend to Cloudflare Pages

**Create Pages Project:**

1. Go to Cloudflare Dashboard → **Workers & Pages**
2. Click **Create** → Select **Pages** tab
3. Connect to your Git repository
4. Configure build settings:
   - **Project name**: `photos` (or your choice)
   - **Production branch**: `main` (or your default branch)
   - **Root directory**: `apps/web`
   - **Build command**: `npm install && npm run build`
   - **Build output directory**: `dist`
   - **Deploy command**: `echo "Deploy complete"`
5. Save and Deploy

**Important**: The `apps/web/public/_routes.json` file configures routing:

```json
{
  "version": 1,
  "include": ["/*"],
  "exclude": ["/api/*", "/media/*"]
}
```

This tells Pages to serve all routes except `/api/*` and `/media/*`, which are handled by the Worker.

### 6. Configure Domain and Routes

1. **Add routes to wrangler.toml** (should already be configured):

   ```toml
   [env.production]
   name = "photos-worker"
   routes = [
     { pattern = "photos.yourdomain.com/api/*", zone_name = "yourdomain.com" },
     { pattern = "photos.yourdomain.com/media/*", zone_name = "yourdomain.com" }
   ]
   ```

2. **Add custom domain to Pages**:
   - In Pages project → **Custom domains**
   - Click **Set up a custom domain**
   - Enter `photos.yourdomain.com`
   - Wait for DNS to propagate

3. **How it works**:
   - Pages serves the React app at `photos.yourdomain.com`
   - Worker handles `photos.yourdomain.com/api/*` and `photos.yourdomain.com/media/*` via routes
   - `_routes.json` prevents Pages from interfering with Worker routes

### 7. Set Up Cloudflare Access (Admin Protection)

**Configure Cloudflare Access**:

1. Go to **Cloudflare Dashboard** → **Zero Trust** → **Access** → **Applications**
2. Click **Add an application** → Select **Self-hosted**
3. Configure application:
   - **Application name**: Photos Admin
   - **Session Duration**: 24 hours (or your preference)
   - **Application domain**:
     - Subdomain: `photos`
     - Domain: `yourdomain.com`
     - Path: `/admin*` (protects all admin routes)
4. Click **Next**
5. Add a Policy:
   - **Policy name**: Admin Access
   - **Action**: Allow
   - **Configure rules**:
     - Include: Emails ending in `@yourdomain.com`
     - Or: Include specific email addresses
6. Click **Next** → **Add application**

**How it works**:

- Users visiting `/admin*` must authenticate via Cloudflare Access
- Cloudflare adds `Cf-Access-Jwt-Assertion` header for authenticated users
- Worker validates this header and sets `X-Admin-Access: 1`
- Admin API endpoints require this header

**Accessing Admin in Production**:

1. Visit <https://photos.yourdomain.com/admin>
2. Cloudflare Access will prompt for authentication
3. Log in with your authorized email
4. You'll be redirected to the admin dashboard
5. Session lasts 24 hours (or configured duration)

## Database Schema

The schema is defined incrementally across 21 files in [migrations/](migrations/) (from `001_init.sql`
through `021_add_file_hash.sql`). Key tables beyond the original `events`/`photos`/`tags`/`event_tags`:

- `event_collaborators` - per-event collaborator records with roles/capabilities
- `collaboration_history` - audit log of invite/role/removal actions
- `invite_links` - shareable, expirable self-service invite links
- `users` (email as primary key) - profile data, admin status derived from `ADMIN_EMAILS`
- `favorites` - per-user favorited photos

Notable `events` columns: `visibility` (`public` | `private` | `collaborators_only`), `description`,
`is_archived`. Notable `photos` columns: `latitude`/`longitude`, `favorites_count`,
`blur_placeholder`, `is_featured`, `media_type`, `uploaded_by`, `source_photo_id`,
`is_notified`, `preview_complete`, `upload_complete`, `file_hash`, `cache_version`.

For the full, current schema see [docs/architecture.md](docs/architecture.md) or inspect
`migrations/*.sql` directly - this README intentionally doesn't duplicate the exhaustive column list
to avoid drifting out of sync as migrations are added.

## R2 Storage Layout

```text
photos-storage/
├── original/
│   └── {eventSlug}/
│       └── {photoId}.{jpg|mp4|cr2|nef|...}   (original file, extension follows source file type)
└── preview/
    └── {eventSlug}/
        └── {photoId}.jpg                     (client-generated, max 1920px, 85% quality JPEG)
```

> **Note**: Preview/original files are **not watermarked** and there is no server-side resizing -
> both derivatives are produced client-side at upload time. A legacy `ig/{eventSlug}/{photoId}.jpg`
> key space still exists only for cleanup purposes (deleting a photo also attempts to remove any
> leftover `ig/` object from older uploads); no code path writes new `ig/` files. See
> [docs/image-processing.md](docs/image-processing.md) for details.

## API Endpoints

See [docs/api-reference.md](docs/api-reference.md) for the full, endpoint-by-endpoint REST API
reference (public, media, admin, collaborators, favorites, mobile auth, and SEO routes).

## Environment Variables & Secrets

### Worker Secrets (via `wrangler secret put`)

- `EVENT_COOKIE_SECRET`: Secret for signing session cookies (required)
- `ADMIN_SHARED_SECRET`: Optional shared secret for admin API in development
- `JWT_SECRET`: Signs/verifies mobile OAuth bearer tokens (required for mobile app auth)
- `MAILGUN_API_KEY` / `MAILGUN_DOMAIN`: Optional, enables collaborator invitation emails
- `GA_MEASUREMENT_ID`: Optional, enables Google Analytics 4 tracking

### Worker Environment Variables

- `ENVIRONMENT`: Set to "development" or "production"
- `ADMIN_EMAILS`: Comma-separated list of admin email addresses

See [docs/configuration.md](docs/configuration.md) for the complete environment variable reference.

## Security Features

- **Password Protection**: SHA-256 hashed with random salt
- **Session Cookies**: HttpOnly, Secure, SameSite=Lax, session-only (no expiry)
- **Admin Protection**: Cloudflare Access + header validation
- **Mobile Auth**: JWT bearer tokens issued after Cloudflare Access verification (see [docs/mobile-oauth.md](docs/mobile-oauth.md))
- **CORS**: Configured for same-origin requests
- **Input Validation**: All API endpoints validate inputs

## Known Limitations & Future Enhancements

1. **No Server-Side Watermarking**: Previews are generated client-side (resized JPEG only); there is no watermark overlay applied anywhere in the current codebase, despite some older code comments/route names implying one.
2. **No Video Transcoding**: Videos are stored and served as uploaded (`.mp4`/`.mov`); editing (trim/crop/speed) happens client-side via FFmpeg WASM, but there's no server-side transcoding pipeline.
3. **Thumbnail Optimization**: Could add smaller thumbnails for the gallery grid instead of reusing the 1920px preview.
4. **iOS**: Only the Android native app is currently packaged/released; the web app itself works in iOS Safari.

## Troubleshooting

### Database Issues

**Worker not connecting to D1**:

- Ensure `database_id` in wrangler.toml matches your D1 database
- Check that ALL migrations have been run (21 files in `migrations/`, run in filename order)
- Verify bindings in `wrangler dev` output
- Run: `wrangler d1 execute photos-db-local --local --command "SELECT name FROM sqlite_master WHERE type='table';"`
  - Should show: events, photos, tags, event_tags, event_collaborators, invite_links, and others

**Missing columns error**:

- You probably didn't run all migrations
- Run each migration file in order (see setup instructions)
- Common missing columns: `is_featured`, `description`, `latitude`, `favorites_count`

### Upload Issues

**Upload failing**:

- Check browser console for CORS errors
- Verify R2 bucket exists and is bound correctly
- Check that files are valid JPEG images
- Ensure multipart upload is supported by R2 binding
- Check network tab for 413 errors (file too large)

**Upload queue not persisting**:

- Check IndexedDB in browser DevTools → Application tab
- Should see `PhotoUploadQueue` database
- Clear IndexedDB and try again if corrupted

### Admin Access Issues

**Admin access denied in development**:

- Check `.dev.vars` file exists in project root
- Verify `ADMIN_SHARED_SECRET` is set
- Check browser Network tab for `X-Admin-Secret` header
- Try clearing browser cache and cookies

**Admin access denied in production**:

- Verify Cloudflare Access is configured for `/admin*` path
- Check you're logged in with authorized email
- Look for `Cf-Access-Jwt-Assertion` header in Network tab
- Ensure `X-Admin-Access: 1` header is being sent to API
- Check worker logs: `wrangler tail --env production`

### Photo Display Issues

**Photos not showing in gallery**:

- Verify event password is correct (if private event)
- Check browser cookies are enabled
- Look for authentication errors in browser console
- Ensure photos exist in R2 storage
- Check Network tab for 403/404 errors on image requests

**Featured photos not showing on landing page**:

- Verify photos are marked as featured (⭐ badge in photo manager)
- Check that featured photos are in PUBLIC events (no password)
- Run: `wrangler d1 execute photos-db --remote --command "SELECT COUNT(*) FROM photos WHERE is_featured = 1;"`
- Landing page falls back to recent photos if no featured photos exist

**Tags not showing**:

- Check that migration 004 was run (creates tags table)
- Verify tags exist: `wrangler d1 execute photos-db --remote --command "SELECT * FROM tags;"`
- Create default tags via admin tag manager

### Performance Issues

**Slow photo loading**:

- Check R2 bucket is in same region as worker
- Verify thumbnails are being generated (not serving originals)
- Check browser Network tab for slow requests
- Consider enabling Cloudflare Cache for `/media/*` routes

**Admin dashboard slow**:

- Large number of photos can slow down stats queries
- Check D1 query performance in worker logs
- Consider adding database indexes (already included in migrations)

### Common Errors

**"No events found"**:

- Database is empty - create an event in admin dashboard
- Or check that events are public (for event list page)

**"Failed to load photos"**:

- Event might not exist
- Event might be password-protected (need to login first)
- Check worker logs for database errors

**"Upload failed" or "Network error"**:

- Worker might not be running
- R2 binding might be misconfigured
- Check CORS headers in worker response

## Development Tips

**Debugging**:

- Use `wrangler tail` to see Worker logs in real-time
- Add `--env production` to tail production worker: `wrangler tail --env production`
- Check browser IndexedDB (Application → Storage) to see upload queue state
- Use browser Network tab to debug API calls and check headers
- React DevTools extension for component debugging

**Testing**:

- Test with various JPEG files to ensure EXIF extraction works
- Test with photos with/without GPS data
- Test with different camera makes/models
- Test password-protected events
- Test admin features with multiple events and photos

**Database Management**:

- Query local database: `wrangler d1 execute photos-db-local --local --command "SELECT * FROM events;"`
- Query production database: `wrangler d1 execute photos-db --remote --command "SELECT * FROM events;"`
- Export database: `wrangler d1 export photos-db --remote --output=backup.sql`
- Check table schema: `wrangler d1 execute photos-db --remote --command "PRAGMA table_info(photos);"`

**Performance**:

- Use `wrangler dev --remote` to test against production D1/R2 (faster than local)
- Monitor D1 query performance in worker logs
- Check R2 bandwidth usage in Cloudflare dashboard

**Workflow Tips**:

- Create test events with different configurations (public, private, tagged)
- Keep a set of test photos with various EXIF data
- Use browser profiles for testing public vs admin views
- Test mobile responsiveness with browser DevTools device emulation

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with:

- [React](https://react.dev/) - UI framework
- [Vite](https://vitejs.dev/) - Build tool
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Hono](https://hono.dev/) - Backend framework
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless platform

## Support

For issues, questions, or contributions, please see [contributing.md](docs/contributing.md).
