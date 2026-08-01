# Architecture Documentation

This document provides a technical overview of the photo sharing application architecture.

## Technology Stack

### Frontend (Web App)

- **Framework:** React 19 with TypeScript
- **Build Tool:** Vite 8
- **Routing:** React Router v7
- **Styling:** Tailwind CSS 4
- **State Management:** React Context API + Hooks
- **Mobile:** Capacitor 8 (Android native wrapper; iOS is not currently packaged)
- **Image Processing:** Browser Canvas API for previews/blur placeholders, `libraw-wasm` for client-side RAW decoding, `react-filerobot-image-editor` + `react-konva` for in-browser image editing
- **Video Processing:** `@ffmpeg/ffmpeg` (WASM, single-threaded) for client-side trim/crop/speed edits
- **HTTP Client:** Axios

### Backend (Worker)

- **Runtime:** Cloudflare Workers (V8 isolates)
- **Framework:** Hono (lightweight web framework)
- **Database:** Cloudflare D1 (SQLite)
- **Storage:** Cloudflare R2 (S3-compatible)
- **Authentication:** Cloudflare Access (web) + JWT bearer tokens (mobile)
- **Email:** Mailgun (optional)

### Infrastructure

- **CDN:** Cloudflare
- **Hosting:** Cloudflare Pages (frontend) + Workers (backend)
- **SSL/TLS:** Automatic via Cloudflare
- **DDoS Protection:** Cloudflare
- **Analytics:** Built-in (no external dependencies)

## System Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         End Users                           │
│              (Web Browsers / Mobile Apps)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare CDN                           │
│          (DDoS Protection, SSL, WAF, Caching)               │
└────────┬────────────────────────────────────────────┬───────┘
         │                                            │
         │ Static Assets                              │ API Requests
         ▼                                            ▼
┌────────────────────┐                    ┌──────────────────────┐
│  Cloudflare Pages  │                    │  Cloudflare Worker   │
│   (React SPA)      │                    │   (Hono Backend)     │
│                    │                    │                      │
│ - React Components │                    │ - API Routes         │
│ - Tailwind CSS     │                    │ - Business Logic     │
│ - Client-side      │                    │ - Authentication     │
│   Image Processing │                    │ - Feature Flags      │
└────────────────────┘                    └──────┬───────┬───────┘
                                                 │       │
                                                 │       │
                           ┌─────────────────────┘       └─────────────────┐
                           │                                               │
                           ▼                                               ▼
                  ┌─────────────────┐                          ┌──────────────────┐
                  │  Cloudflare D1  │                          │  Cloudflare R2   │
                  │   (SQLite DB)   │                          │ (Object Storage) │
                  │                 │                          │                  │
                  │ - Events        │                          │ - Original Photos│
                  │ - Photos        │                          │ - Preview Images │
                  │ - Users         │                          │ - Videos         │
                  │ - Favorites     │                          │                  │
                  │ - Collaborators │                          │ Folders:         │
                  └─────────────────┘                          │ - original/      │
                                                               │ - preview/       │
                                                               └──────────────────┘
                           │
                           │ Optional
                           ▼
                  ┌─────────────────┐
                  │     Mailgun     │
                  │  (Email Service)│
                  │                 │
                  │ - Invitations   │
                  │ - Notifications │
                  └─────────────────┘
```

## Project Structure

```text
.
├── apps/
│   ├── web/                    # Frontend React application
│   │   ├── src/
│   │   │   ├── components/     # Reusable UI components (ImageEditorModal, VideoEditorModal,
│   │   │   │                  # CastButton/CastReceiver, PullToRefresh, OfflineBanner, ...)
│   │   │   ├── contexts/       # React contexts (Auth, Upload, etc.)
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── pages/          # Page components (routes) (Timeline, PhotoUsage, PrivacyPolicy,
│   │   │   │                  # InviteAccept, ...)
│   │   │   ├── services/       # Business logic services (uploadManager, backgroundSync, ...)
│   │   │   ├── utils/          # Utility functions
│   │   │   ├── rawImageUtils.ts # Client-side RAW (.cr2/.nef/.arw/.dng/...) decoding via libraw-wasm
│   │   │   ├── imageUtils.ts   # Preview/blur-placeholder generation (Canvas API)
│   │   │   ├── api.ts          # API client
│   │   │   ├── config.ts       # Runtime configuration
│   │   │   └── types.ts        # TypeScript types
│   │   ├── android/            # Capacitor Android project
│   │   └── public/             # Static assets
│   │
│   └── worker/                 # Backend Cloudflare Worker
│       ├── src/
│       │   ├── routes/         # API route handlers
│       │   │   ├── admin/      # Admin-only routes (modular)
│       │   │   │   ├── events.ts      # Event CRUD
│       │   │   │   ├── uploads.ts     # Upload handling
│       │   │   │   ├── photos.ts      # Photo management (incl. featured/replace/bulk ops)
│       │   │   │   ├── analytics.ts   # Statistics
│       │   │   │   ├── tags.ts        # Tag CRUD
│       │   │   │   └── utilities.ts   # Geocoding, thumbnails, misc utilities
│       │   │   ├── admin.ts           # Admin router orchestrator (mounted at /api/admin)
│       │   │   ├── collaborators.ts   # Collaboration features + invite links
│       │   │   ├── favorites.ts       # Favorites system + user profile
│       │   │   ├── media.ts           # Serves original/preview images & videos from R2
│       │   │   ├── zip.ts             # Batch ZIP download
│       │   │   ├── features.ts        # Public favoriting/featured/tag endpoints
│       │   │   ├── mobileAuth.ts      # Mobile OAuth login + token issuance
│       │   │   └── seo.ts             # SEO endpoints
│       │   ├── auth.ts         # Authentication middleware
│       │   ├── config.ts       # Configuration management
│       │   ├── features.ts     # Feature flag system
│       │   ├── geocoding.ts    # Reverse geocoding
│       │   ├── imageProcessing.ts  # Watermark text helpers (currently unused by any route)
│       │   ├── fileTypeUtils.ts # File-type/extension helpers (images, videos, RAW)
│       │   ├── index.ts        # Worker entry point
│       │   ├── types.ts        # TypeScript types
│       │   └── utils.ts        # Utility functions
│       └── wrangler.toml       # Worker configuration
│
├── migrations/                 # D1 database migrations
│   └── *.sql                   # SQL migration files
│
├── docs/                       # Documentation files
└── scripts/                    # Utility and setup scripts
```

## Core Modules

### Frontend Architecture

#### Frontend Configuration System (`config.ts`)

```typescript
// Production: Injected by worker at runtime
window.__CONFIG__ = { apiUrl: '...', brandName: '...' };

// Development: Falls back to VITE_ environment variables
getConfig() → reads window.__CONFIG__ || import.meta.env
```

#### Authentication Context (`contexts/AuthContext.tsx`)

Global authentication state using React Context:

- OAuth flow with Cloudflare Access
- JWT token management
- User session persistence
- Admin privilege checking

#### API Client (`api.ts`)

Centralized API communication:

- Axios instance with interceptors
- Automatic token injection
- Error handling
- URL construction helpers

#### Custom Hooks

- `usePhotoSelection.ts` - Photo selection state management
- `useAuth` - Authentication hook (from AuthContext)

#### Key Components

- **PhotoCard** - Individual photo with selection, favorites, EXIF
- **EventGallery** - Main gallery view with filtering, sorting
- **AdminEventUpload** - Upload interface with drag-drop
- **Navbar / Footer** - Navigation with dynamic branding

### Backend Architecture

#### Backend Configuration System (`config.ts`)

Environment-aware configuration:

```typescript
getConfig(env) → {
  appName, brandName, domain, contactEmail,
  adminEmails, jwtSecret, mailgunApiKey, ...
}
```

#### Feature Flags (`features.ts`)

Automatic feature detection:

```typescript
getFeatures(config) → {
  hasMailgun, canSendEmails, enableCollaborators,
  enableFavorites, enableGeocoding, ...
}

// Middleware
requireFeature('enableCollaborators')

// Inline check
checkFeature(env, 'canSendEmails')
```

#### Authentication (`auth.ts`)

Multi-layer security:

1. **Cloudflare Access** - OAuth at CDN level
2. **JWT Verification** - Token validation
3. **Admin Check** - Email-based admin authorization
4. **Upload Permissions** - Collaborator or admin

Middleware functions:

- `requireAuth` - Authenticated users only
- `requireAdmin` - Admin users only
- `requireUploadPermission` - Admin or event collaborator

#### Route Structure

**Admin Routes** (modular):

- `admin/events.ts` - Event CRUD operations
- `admin/uploads.ts` - Multipart upload handling
- `admin/photos.ts` - Photo management
- `admin/analytics.ts` - Statistics endpoints
- `admin/tags.ts` - Tag management
- `admin/utilities.ts` - Geocoding, thumbnails

**Public Routes**:

- `public.ts` - Events, photos, timeline, tags (listing/detail)
- `media.ts` - Serves original/preview image and video bytes from R2 (range-request aware)
- `zip.ts` - Batch ZIP download
- `features.ts` - Public featured/most-favorited photos, favoriting, by-tag lookup
- `collaborators.ts` - Collaboration features + invite links
- `favorites.ts` - User favorites + profile
- `mobileAuth.ts` - Mobile OAuth login (`/api/mobile-login`) and token issuance (`/api/mobile-auth`)
- `seo.ts` - Sitemap, robots.txt

## Data Flow

### Photo Upload Flow

```text
1. User selects photo in browser
   └─> Client reads EXIF, generates blurhash
       └─> Client creates preview (1200px max)
           └─> POST /admin/events/:slug/uploads/start
               └─> Worker creates multipart upload in R2
                   └─> Client uploads preview parts
                       └─> POST /admin/events/:slug/uploads/:id/complete?preview=true
                           └─> Client uploads original parts
                               └─> POST /admin/events/:slug/uploads/:id/complete
                                   └─> Worker sends notification (if collaborator)
                                       └─> Photo appears in gallery
```

### Authentication Flow

```text
1. User visits protected page
   └─> Cloudflare Access challenges user
       └─> User logs in with OAuth (Google, etc.)
           └─> Access issues JWT token
               └─> Frontend stores token
                   └─> API requests include token
                       └─> Worker validates JWT
                           └─> Worker checks admin status
                               └─> Request authorized
```

### Feature Flag Flow

```text
1. Request hits worker
   └─> Middleware checks feature requirement
       └─> getConfig(env) reads environment
           └─> getFeatures(config) evaluates flags
               └─> Mailgun configured?
                   ├─> Yes: enableCollaborators = true
                   └─> No: enableCollaborators = false
                       └─> Return 503 "Feature not available"
```

## Database Schema

### Core Tables

#### events

- Event metadata, passwords, visibility
- Foreign key parent for photos, collaborators, tags

#### photos

- Photo metadata, EXIF data, GPS coordinates
- References event, stores uploaded_by name

#### users

- OAuth user profiles (email, name, avatar)
- Admin status determined by env var, not DB

#### event_collaborators

- Many-to-many: events ↔ users
- Tracks invitation and acceptance dates

#### user_favorites

- Many-to-many: users ↔ photos
- Stores favorite relationships

#### tags & event_tags

- Tag definitions and event associations

#### collaboration_history

- Audit log of collaborator actions

#### invite_links

- Shareable invitation tokens
- Time-limited, single-use or multi-use

See [migrations/](../migrations/) for complete schema.

## Performance Optimizations

### Frontend

1. **Image Processing**
   - Client-side preview generation reduces upload size
   - Blurhash placeholders for instant loading feedback
   - Canvas-based resizing before upload

2. **Code Splitting**
   - Route-based code splitting with React.lazy
   - Dynamic imports for heavy components

3. **Caching**
   - Service worker caching (if implemented)
   - Browser cache headers from CDN

### Backend

1. **Edge Computing**
   - Worker runs on Cloudflare's global network
   - <10ms CPU time per request
   - No cold starts (V8 isolates)

2. **Database Optimization**
   - Indexed queries for common lookups
   - Prepared statements for security & speed
   - Selective column fetching

3. **Storage**
   - Direct R2 uploads (no worker proxy)
   - CDN caching for frequently accessed photos
   - Multipart uploads for large files

## Security

### Authentication Layers

1. **Cloudflare Access** - Blocks unauthenticated requests
2. **JWT Validation** - Verifies token signature and expiry
3. **Admin Authorization** - Checks email against ADMIN_EMAILS
4. **Event Permissions** - Checks collaborator relationships

### Data Protection

1. **HTTPS Only** - All traffic encrypted
2. **CORS** - Restricted to configured domain
3. **SQL Injection** - Prepared statements only
4. **XSS Protection** - React auto-escapes output
5. **CSRF** - SameSite cookies + JWT tokens

### Secrets Management

All sensitive values stored as Cloudflare secrets:

- Never in code or version control
- Encrypted at rest
- Access-controlled via Cloudflare dashboard

## Scalability

### Horizontal Scaling

- **Workers**: Auto-scale to millions of requests
- **D1**: Handles 10k+ RPS (reads), 1k+ RPS (writes)
- **R2**: Unlimited storage, high throughput
- **CDN**: Global edge network

### Limitations

- **D1**: 1GB database size per database
- **R2**: No hard limits, pay-as-you-go
- **Workers**: 128MB memory, 30s CPU time (enterprise)

### Growth Path

1. **Small**: Single region, <1000 photos
2. **Medium**: Multi-region D1 read replicas
3. **Large**: Multiple D1 databases (sharding by year)
4. **Enterprise**: Durable Objects for real-time features

## Monitoring

### Built-in Metrics

- Worker analytics in Cloudflare dashboard
- D1 query performance metrics
- R2 storage and bandwidth usage

### Recommended External Tools

- **Sentry** - Error tracking
- **LogFlare** - Log aggregation
- **Prometheus** - Custom metrics (if needed)

## Development Workflow

### Local Development

1. Use Wrangler CLI for worker development
2. Vite dev server for frontend with HMR
3. D1 local database for testing
4. R2 local emulation (or dev bucket)

### Testing

- Frontend: Vitest + React Testing Library (`npm test` in `apps/web`)
- E2E: Playwright tests (`npm run test:e2e` in `apps/web`)
- Worker: Vitest (`npm test` in `apps/worker`)

### Deployment

1. **Worker**: `wrangler deploy`
2. **Frontend**: Build → Deploy to Pages
3. **Migrations**: `for file in ./migrations/*.sql; do wrangler d1 execute <db-name> --remote --file="$file"; done` (this project applies plain numbered SQL files directly rather than using Wrangler's migrations-tracking system)

## Future Enhancements

Potential improvements:

1. **Real-time Features** - Durable Objects for live collaboration
2. **Server-Side Video Transcoding** - Cloudflare Stream integration (today, video editing/trimming happens entirely client-side via FFmpeg WASM; there is no server-side transcoding or adaptive bitrate streaming)
3. **AI Features** - Workers AI for auto-tagging
4. **Advanced Search** - Full-text search with Vectorize
5. **CDN Optimization** - Polish for automatic image optimization
6. **iOS App** - Package the existing Capacitor web app for iOS (currently Android-only)

## References

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Framework](https://hono.dev/)
- [React Documentation](https://react.dev/)
- [Vite Guide](https://vitejs.dev/)
