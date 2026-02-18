# Photo Sharing Application

A full-stack, white-label photo gallery application built with React + Vite + Tailwind (frontend) and Cloudflare Workers (backend), with D1 database and R2 storage.

> **Open Source & Self-Hosted**: Deploy your own branded photo sharing platform with complete control over your data.

## Documentation

- **[Configuration Guide](docs/configuration.md)** - Complete setup and deployment instructions
- **[API Reference](docs/api-reference.md)** - REST API endpoint documentation
- **[Architecture](docs/architecture.md)** - Technical architecture and design
- **[Features](docs/features.md)** - Feature descriptions and usage examples
- **[Contributing](docs/contributing.md)** - Contribution guidelines and development workflow

## 🏗️ Architecture

### Frontend (`apps/web`)
- **Framework**: React 18.3 + TypeScript
- **Build Tool**: Vite 6.4
- **Styling**: Tailwind CSS 3.4
- **Routing**: React Router v6
- **State**: React hooks + localStorage
- **Storage**: IndexedDB (via Dexie) for upload queue persistence
- **Maps**: Leaflet + React-Leaflet
- **Image Processing**: Client-side Canvas API for preview generation

### Backend (`apps/worker`)
- **Runtime**: Cloudflare Workers
- **Framework**: Hono 4.6
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (S3-compatible)
- **Auth**: HTTP-only cookies with session tokens
- **Image Processing**: Client-side (Canvas API), watermarking server-side

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
- 🗺️ **Map View**: Browse all photos with GPS coordinates on interactive map
- ⬇️ **Download Options**:
  - Original full-resolution JPEG
  - Preview (1920px @ 85% quality)
  - Batch download selected photos as ZIP (max 50)
- ⭐ **Favorites**: Add photos to favorites, view in dedicated favorites page
- 🎨 **Progressive Images**: Blur placeholder → full image transition
- 🔄 **Smart Caching**: Preview images cached by browser

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
- 📤 **Drag & Drop**: Upload multiple photos at once
- 🔄 **Persistent Queue**: IndexedDB-backed upload queue survives page reloads
- 📦 **Multipart Upload**: Efficient large file uploads (5MB chunks) to R2
- 📊 **EXIF Extraction**: Automatic metadata extraction (camera, lens, settings, GPS)
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

#### Tag Manager (`/admin/tags`)
- 🏷️ **Tag CRUD**: Create, edit, and delete tags
- 📊 **Usage Stats**: See how many events use each tag
- 🔗 **Auto-Slugs**: Automatic URL-friendly slug generation
- 📝 **Descriptions**: Add descriptions to tags for context
- ⚠️ **Safe Deletion**: Warns before deleting tags in use

#### Collaborator System
- 👥 **Invite Users**: Invite collaborators by email to upload photos to specific events
- 📧 **Email Notifications**: Automatic invitation emails with event details
- ⚡ **Upload Permissions**: Collaborators can upload photos/videos without admin access
- 📊 **Status Tracking**: See pending, accepted, or declined invitations
- 🔒 **Secure Access**: Uses Cloudflare Access authentication
- 🗑️ **Easy Management**: Add or remove collaborators anytime from admin dashboard
- 📚 **Documentation**: See [COLLABORATORS.md](./COLLABORATORS.md) for detailed guide

#### Technical Features
- 🔐 **Cloudflare Access**: Secure admin authentication
- 🔒 **Admin-Only APIs**: X-Admin-Access header validation
- 🎨 **Responsive Design**: Works on desktop, tablet, and mobile
- ✅ **Real-time Feedback**: Success/error messages for all actions
- 🚀 **Optimized Performance**: Efficient queries and caching

## Architecture

```
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
# Web app runs on http://localhost:3000
# API requests are proxied to the worker
```

### 6. Access the Application

- **Public site**: http://localhost:3000
- **Admin dashboard**: http://localhost:3000/admin
- **Worker API**: http://localhost:8787 (direct access)

---

## Running the Application

### Local Development

Once setup is complete, you need **two terminal windows** running simultaneously:

**Terminal 1 - Worker (Backend API)**:
```bash
cd apps/worker
npm run dev
```
- Runs on http://localhost:8787
- Handles all `/api/*` and `/media/*` requests
- Auto-reloads on code changes
- Access to local D1 and simulated R2 storage

**Terminal 2 - Web App (Frontend)**:
```bash
cd apps/web
npm run dev
```
- Runs on http://localhost:3000
- Proxies API requests to worker on port 8787
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
2. Create an event at http://localhost:3000/admin
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

# Run ALL migrations on production database (in order!)
wrangler d1 execute photos-db --remote --file=./migrations/001_init.sql
wrangler d1 execute photos-db --remote --file=./migrations/002_add_exif_data.sql
wrangler d1 execute photos-db --remote --file=./migrations/003_optional_passwords.sql
wrangler d1 execute photos-db --remote --file=./migrations/004_enhanced_features.sql
wrangler d1 execute photos-db --remote --file=./migrations/002_admin_improvements.sql
wrangler d1 execute photos-db --remote --file=./migrations/005_add_city_column.sql
wrangler d1 execute photos-db --remote --file=./migrations/006_user_favorites.sql
wrangler d1 execute photos-db --remote --file=./migrations/007_add_media_type.sql
wrangler d1 execute photos-db --remote --file=./migrations/008_event_collaborators.sql

# Or run them all at once:
for file in ./migrations/*.sql; do wrangler d1 execute photos-db --remote --file="$file"; done

# Verify migrations were successful:
wrangler d1 execute photos-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
# Should show: events, photos, tags, event_tags tables
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

1. Visit https://photos.yourdomain.com/admin
2. Cloudflare Access will prompt for authentication
3. Log in with your authorized email
4. You'll be redirected to the admin dashboard
5. Session lasts 24 hours (or configured duration)

## Database Schema

### Events Table
- `id`: Primary key (auto-increment)
- `slug`: Unique event identifier (URL-friendly)
- `name`: Event name
- `password_salt`: Optional random salt for password hashing (nullable)
- `password_hash`: Optional SHA-256 hash of salted password (nullable)
- `preview_photo_id`: Optional ID of photo to use as preview (nullable)
- `inferred_date`: Earliest photo capture date (YYYY-MM-DD)
- `description`: Optional event description (nullable) **NEW**
- `is_archived`: Boolean flag for archived events (default: 0) **NEW**
- `created_at`: Event creation timestamp

### Photos Table
- `id`: ULID/UUID string
- `event_id`: Foreign key to events
- `original_filename`: Original file name
- `capture_time`: EXIF capture timestamp (ISO 8601)
- `uploaded_at`: Upload timestamp
- `width`: Image width in pixels
- `height`: Image height in pixels
- `camera_make`: Camera manufacturer (nullable)
- `camera_model`: Camera model (nullable)
- `lens_model`: Lens model (nullable)
- `focal_length`: Focal length in mm (nullable)
- `aperture`: Aperture f-number (nullable)
- `shutter_speed`: Shutter speed (nullable)
- `iso`: ISO sensitivity (nullable)
- `latitude`: GPS latitude (nullable) **NEW**
- `longitude`: GPS longitude (nullable) **NEW**
- `favorites_count`: Number of times favorited (default: 0) **NEW**
- `blur_placeholder`: Base64 tiny blurred placeholder (nullable) **NEW**
- `is_featured`: Boolean flag for featured photos (default: 0) **NEW**

### Tags Table **NEW**
- `id`: Primary key (auto-increment)
- `name`: Tag name (unique)
- `slug`: URL-friendly slug (unique)
- `created_at`: Tag creation timestamp

### Event_Tags Table (Junction) **NEW**
- `event_id`: Foreign key to events
- `tag_id`: Foreign key to tags
- Primary key: (event_id, tag_id)

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

**Events**:
- `GET /api/events` - List all events
- `GET /api/events/:slug` - Get event details
- `GET /api/events/by-tag/:tagSlug` - Get events by tag **NEW**
- `POST /api/events/:slug/login` - Authenticate to event

**Photos**:
- `GET /api/events/:slug/photos` - List photos (requires auth)
- `GET /api/events/:slug/photos/:photoId` - Get photo details (requires auth)
- `GET /api/photos/featured` - Get featured photos for landing page **NEW**
- `GET /api/photos/most-favorited` - Get most favorited photos **NEW**
- `GET /api/photos/with-gps` - Get all photos with GPS coordinates **NEW**
- `POST /api/events/:slug/zip` - Request batch download (requires auth)

**Tags**:
- `GET /api/tags` - List all tags **NEW**

### Media Endpoints (Password Gated)

- `GET /media/:slug/preview/:photoId.jpg` - Watermarked preview (2000px max)
- `GET /media/:slug/ig/:photoId.jpg` - Instagram-ready (1080px max)
- `GET /media/:slug/original/:photoId.jpg` - Full resolution original

### Admin API (Requires Admin Access)

**Dashboard & Stats**:
- `GET /api/admin/stats` - Get dashboard statistics **NEW**
- `GET /api/admin/events/:slug/stats` - Get event-specific analytics **NEW**

**Event Management**:
- `POST /api/admin/events` - Create event
- `PUT /api/admin/events/:slug` - Update event (name, description, password) **NEW**
- `DELETE /api/admin/events/:slug` - Delete event with cascade **NEW**
- `POST /api/admin/events/:slug/tags` - Set event tags **NEW**
- `POST /api/admin/events/:slug/location` - Set event GPS location
- `POST /api/admin/events/:slug/regenerate-thumbnails` - Regenerate all thumbnails

**Photo Management**:
- `POST /api/admin/events/:slug/uploads/start` - Start multipart upload
- `POST /api/admin/events/:slug/uploads/:photoId/parts/:partNumber` - Upload part
- `POST /api/admin/events/:slug/uploads/:photoId/complete` - Complete upload
- `DELETE /api/admin/photos/:photoId` - Delete single photo **NEW**
- `POST /api/admin/photos/:photoId/featured` - Toggle featured status **NEW**

**Tag Management**:
- `POST /api/admin/tags` - Create new tag **NEW**
- `PUT /api/admin/tags/:id` - Update tag **NEW**
- `DELETE /api/admin/tags/:id` - Delete tag **NEW**

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

### Database Issues

**Worker not connecting to D1**:
- Ensure `database_id` in wrangler.toml matches your D1 database
- Check that ALL migrations have been run (5 total)
- Verify bindings in `wrangler dev` output
- Run: `wrangler d1 execute photos-db-local --local --command "SELECT name FROM sqlite_master WHERE type='table';"`
  - Should show: events, photos, tags, event_tags

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
