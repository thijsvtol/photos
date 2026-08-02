# Features Documentation

Comprehensive guide to all features in the photo sharing application.

## Core Features

### 📸 Event Management

Organize photos into discrete events with rich metadata.

**Key Capabilities:**

- Create unlimited events with custom slugs
- Set event date, location, and description
- GPS coordinates with automatic reverse geocoding
- Public or private visibility control
- Optional password protection
- Tag events for easy discovery

**Admin Dashboard:**

- Create/edit/delete events
- Bulk photo upload
- Event analytics
- Collaborator management

**Use Cases:**

- Wedding photo galleries
- Birthday party albums
- Vacation photo collections
- Corporate event documentation
- Family reunion galleries

---

### 🖼️ Photo Upload & Management

Advanced photo upload system with automatic processing.

**Upload Features:**

- Drag-and-drop interface
- Multi-file selection
- Upload queue with progress tracking
- Retry failed uploads
- Client-side image preview generation
- EXIF data extraction
- GPS location extraction
- Blurhash generation for placeholders

**Image Processing:**

- **Original**: Full resolution preserved (including RAW files, kept in their native format)
- **Preview**: Client-generated JPEG, max 1920px on the longest side, 85% quality
- No server-side watermarking, resizing, or Instagram-style square crop is applied — both
  derivatives above are produced entirely client-side at upload time (see
  [image-processing.md](./image-processing.md))

**Supported Formats:**

- JPEG (.jpg, .jpeg)
- PNG (.png)
- HEIC (.heic) - iOS photos
- WebP (.webp)
- RAW formats (.cr2, .nef, .arw, .dng, and other libraw-supported formats) - decoded client-side via `libraw-wasm` to generate a JPEG preview; the original RAW file is preserved as-is
- Videos (.mp4, .mov) - stored and served as uploaded; no server-side transcoding

**Metadata Preserved:**

- Camera make/model
- ISO, aperture, shutter speed
- Focal length
- Capture timestamp
- GPS coordinates
- Image dimensions

---

### ✂️ Image & Video Editing

Edit photos and videos directly in the browser (and in the native Android app) before or after
upload, without needing external software.

**Image Editing** (powered by `react-filerobot-image-editor` + `react-konva`):

- Crop and rotate
- Curves and levels adjustments
- Save back to the event, replacing the original and/or preview in R2

**Video Editing** (powered by `@ffmpeg/ffmpeg`, running fully client-side as WASM):

- Trim start/end
- Crop and rotate
- Playback speed adjustment
- Single-threaded FFmpeg core is used, so no cross-origin isolation (COOP/COEP) headers are required

**Native Considerations:**

- On native Android, media is fetched as a same-origin blob before editing to avoid canvas-tainting
  issues with cross-origin image loads in the WebView
- Multipart `FormData` uploads are unreliable in the Android WebView, so the "replace edited photo"
  endpoint accepts raw `application/octet-stream` bodies on native (with a legacy multipart fallback
  for web)

---

### 📡 Casting & Offline

**Chromecast:**

- Cast photos and videos from the web app to a Chromecast-enabled TV

**Offline Awareness:**

- Offline banner indicates when the device has no network connectivity
- Pull-to-refresh gesture across the app (disabled on routes with conflicting gestures, e.g. the
  photo detail swipe view)
- Native background upload queue continues syncing when connectivity returns

---

### 🕓 Timeline View

A chronological, infinite-scroll view (`/timeline`) across all events the current user can access,
mixing photos and videos by capture/upload time rather than browsing event-by-event.

---

### 🗺️ Location & Geocoding

Automatic location detection from GPS data.

**Features:**

- Extract GPS coordinates from EXIF
- Reverse geocoding to readable addresses
- Display location on maps
- Filter photos by location
- Privacy: optional GPS data removal

**Location Hierarchy:**

- Country
- State/Province
- City
- Custom location name

**Data Source:**

- OpenStreetMap Nominatim API
- No API key required
- Respects rate limits
- Fallback to manual entry

**Manual Override:**

- Edit location after upload
- Add location to photos without GPS
- Batch location updates

---

### 🔐 Authentication & Authorization

Multi-layer security with OAuth and role-based access.

**Authentication Methods:**

- Cloudflare Access (OAuth)
- Supported providers: Google, GitHub, Microsoft, etc.
- JWT token for API access
- Session persistence

**Permission Levels:**

**Admin:**

- Full access to all features
- Create/edit/delete events
- Manage collaborators
- Access analytics
- Configure settings

**Collaborator:**

- Upload to assigned events
- View collaborator-only events
- Receive notifications

**Authenticated User:**

- View public events
- Add favorites
- Access password-protected events with password

**Public (Unauthenticated):**

- View public events only
- No favorites or uploads
- Password-protected access with password

**Email-Based Admin:**

- Admin status determined by `ADMIN_EMAILS` env var
- Comma-separated email list
- No database management needed

---

### 🤝 Collaboration System

**Status:** Optional (requires Mailgun)

Invite others to upload photos to your events.

**Invitation Methods:**

1. **Email Invitation**:
   - Send invitation to specific email
   - Personalized email with event details
   - One-click acceptance
   - Automatic collaborator status

2. **Shareable Invite Links**:
   - Generate public invite URL
   - Set expiration date (1-30 days)
   - Limit number of uses
   - Single-use or multi-use
   - Revoke anytime

**Collaborator Features:**

- Upload photos to event
- View event details
- Receive upload notifications
- See other collaborators

**Notification System:**

- Email when invited
- Email when someone uploads (if collaborator)
- Configurable per-event

**History Tracking:**

- Audit log of collaborator actions
- Track invitation/acceptance dates
- Monitor upload activity

**Use Cases:**

- Wedding photographers + family contributions
- Event attendees sharing photos
- Team photo collections
- Multi-photographer projects

---

### ⭐ Favorites System

Save favorite photos for quick access.

**Features:**

- One-click favorite/unfavorite
- Personal favorites (not visible to others)
- Filter by favorites in gallery
- Dedicated favorites page
- Cross-event favorites

**Analytics:**

- Most favorited photos (admin)
- Per-user favorite counts
- Trending photos

**Implementation:**

- Real-time updates
- Optimistic UI updates
- Per-user storage

---

### 🖼️ Gallery Views

Flexible photo viewing with advanced controls.

**Grid View:**

- Responsive masonry layout
- Infinite scroll
- Lazy loading
- Blurhash placeholders
- Hover previews

**Lightbox View:**

- Full-screen photo viewing
- Keyboard navigation (← →)
- Swipe gestures (mobile)
- Zoom capability
- EXIF data overlay
- Location information
- Download original

**Sorting Options:**

- Date taken (newest/oldest)
- Upload date
- Filename
- Location
- Favorites first

**Filtering:**

- By date range
- By location
- By uploader
- Favorites only

**Sharing:**

- Share individual photo URLs
- Share event URLs
- Copy image URLs
- Download originals

---

### 📊 Analytics Dashboard

**Status:** Admin only

Comprehensive insights into usage and engagement.

**Overall Statistics:**

- Total events
- Total photos
- Total users
- Total favorites
- Total collaborations

**Per-Event Analytics:**

- Photo count
- Collaborator count
- Favorite count
- Upload timeline
- Location distribution

**Per-User Analytics:**

- Upload count
- Favorite count
- Collaboration count
- Activity timeline

**Popular Photos:**

- Most favorited
- Most viewed (if tracking added)
- Recent activity

**Export Capabilities:**

- CSV export (future)
- API access to stats
- Dashboard widgets (future)

---

### 🏷️ Tagging System

Categorize and discover events with tags.

**Tag Features:**

- Admin-created tags
- Assign multiple tags per event
- Filter events by tag
- Tag usage analytics
- Tag suggestions

**Common Tags:**

- `wedding`, `birthday`, `vacation`
- `music`, `sports`, `outdoor`
- `family`, `friends`, `corporate`
- `2024`, `summer`, `europe`

**Management:**

- Create/delete tags
- Bulk tag assignment
- Tag renaming
- Merge duplicate tags

---

### 🧠 AI-Powered Search & Organization

**Status:** Free-tier only (Cloudflare Workers AI, ~10,000 neurons/day at no cost)

- **Unified search** (`/search`): matches filename, city/location, and AI-generated photo
  captions via SQLite FTS5, optionally re-ranked by semantic similarity (cosine similarity between
  the search query's embedding and each photo's stored embedding)
- **AI captions**: a Workers AI vision model (`@cf/llava-hf/llava-1.5-7b-hf`) generates a short
  description for each photo, generated gradually by a batch-limited hourly cron job (never a
  per-upload call, to stay within the free daily allocation)
- **People**: faces are detected and embedded entirely client-side at upload time
  (`@vladmandic/human` — MediaPipe BlazeFace detector + FaceRes description model, chosen over
  face-api.js for better recall on the angled/action-shot faces common in sports photography,
  since Workers AI has no face-embedding model), then grouped into person clusters by an hourly
  server-side clustering job (pure vector math, no AI calls — using Human's own documented
  distance/similarity formula). Admins can name, merge, and delete people groups at
  `/admin/people`. Groups with only a single photo so far are hidden from the default view (often
  just a person who hasn't had a second photo clustered to them yet); a "Show N single-photo
  groups" toggle reveals them on demand, and the empty state distinguishes "nothing detected yet"
  from "found groups, they're just all single-photo right now". Photos uploaded before this
  feature existed can be backfilled via a "Scan Library for Faces" action on the same page —
  detection has to run in the browser, so this is a client-driven scan (with progress/cancel)
  rather than a server cron. Each clustering run processes a small, CPU-budget-adaptive batch of
  faces — Cloudflare's Workers Free plan hard-caps CPU time at 10ms per request/cron trigger (not
  wall-clock time), and one similarity comparison costs `O(embedding dimensions)` (1024 floating-
  point ops, not O(1)), so a face is only ever compared against the (at most 300) most-
  established existing people — never the whole library — with a real wall-clock guard between
  faces as a backstop, so cost can never grow unbounded no matter how many distinct people have
  been recognized. A "Cluster Now" button on the same page lets an admin trigger this immediately
  and repeatedly (looping many small calls to `POST /admin/people/cluster-now` client-side until
  the backlog is drained) instead of waiting for the next hourly cron tick
- **Merge suggestions**: because clustering only ever compares a new face against the top 300
  most-established people (see above), two clusters can genuinely be the same person without
  clustering ever getting the chance to notice. A "Find Merge Suggestions" button on
  `/admin/people` runs a separate, complete `O(clusterCount²)` pairwise scan across every person
  (not limited to a top-N subset, since here the goal is thoroughness rather than a fast
  per-upload decision) via `GET /admin/people/merge-suggestions`, resumable via a cursor across
  many small CPU-safe steps the same way clustering itself is — bounded by a *deterministic
  dimension-operation* budget rather than a wall-clock timer, since this scan's comparison loop
  has no I/O in it and Cloudflare Workers deliberately freezes `Date.now()` during synchronous
  execution (a Spectre-timing mitigation), which would make a timer-based guard a silent no-op
  here. Each comparison also exits early the instant it's mathematically certain a pair can't
  match, letting one call examine far more pairs than a naive always-check-all-1024-dimensions
  approach could. Suggestions use a deliberately *lower* similarity bar than automatic
  clustering (since every suggestion is manually reviewed before merging, unlike auto-clustering)
  — and if that still finds nothing, the search automatically retries once with an even broader
  threshold before giving up, since this app's action-sports photos (helmets/goggles/odd angles)
  can legitimately score below even a normal "same person" bar for genuinely matching faces.
  Matches are shown side-by-side with a similarity score for one-click merge (or dismiss)
- **Linking a person to an account**: on a person's detail page (`/admin/people/:id`), an admin
  can search for and link an existing user account (by email) to that person cluster — at most
  one account per person (enforced with a partial unique index on
  `person_clusters.linked_user_email`). Once linked, that account sees a "Just me" filter toggle
  next to the Timeline heading (`GET /api/me/photos`), which filters the grid down to only photos
  containing their face. The full name an admin gives a person is admin-only — the toggle label
  and its filtered view only ever use their first name (see `utils.ts`'s `firstNameOf()`), never
  the full name

---

### 🗑️ Trash & Archive

- **Trash**: deleted photos are kept for 30 days (restorable) before being permanently purged by a
  nightly job; admins can also empty the trash or permanently delete a single photo immediately
- **Archive**: hide a photo from the Timeline without deleting it — it still appears in its
  event's gallery

---

### 🕰️ Memories

An "on this day" carousel on the Timeline page surfaces photos captured on today's date in
previous years, grouped by year — pure SQL, no AI involved.

---

### 📁 Albums

Cross-event photo collections (`/admin/albums`), independent of the event structure — useful for
curating a "best of" collection spanning multiple events.

---

### 🔁 Duplicate Detection

Photos with byte-identical content (same SHA-256 file hash, computed client-side at upload) are
grouped at `/admin/duplicates`, even if uploaded to different events, so admins can clean up
accidental re-uploads.

---

### 📜 Activity Feed

A polling-based (not realtime — avoids requiring Cloudflare's paid Workers plan/Durable Objects)
activity log at `/admin/activity` showing recent favorites, event/album creation, and photo
trashing across the whole site.

---

### ✨ Auto Enhance

One-tap client-side auto white balance + contrast stretch for a photo, available from the Photo
Manager — no server round-trip beyond saving the result.

---

### 📤 Auto-Backup (Android)

On the native Android app, pick a device folder (e.g. your camera roll) to automatically sync new
photos/videos to a specific event in the background, using Android's Storage Access Framework —
configured per-event from the event edit modal.

---

### 🔒 Privacy & Security

**Event Visibility:**

**Public Events:**

- Listed on homepage
- Visible to anyone with link
- Indexed by search engines (sitemap)

**Private Events:**

- Not listed publicly
- Only admins and collaborators see
- Require direct link

**Password Protected:**

- Additional password layer
- Session-based access
- Per-event passwords
- Optional expiration

**Data Security:**

- HTTPS only
- JWT token authentication
- SQL injection prevention
- XSS protection
- CORS restrictions
- Cloudflare DDoS protection

**Privacy Controls:**

- Remove GPS data option
- Hide photos from public
- Delete photos permanently
- Revoke collaborator access

---

### 📱 Mobile Experience

**Progressive Web App:**

- Responsive design
- Touch-optimized UI
- Swipe gestures
- Offline banner + pull-to-refresh (offline *viewing* of already-cached content depends on the
  browser cache; there is no dedicated offline-first data store on web)

**Native Android App:**

- Built with Capacitor
- Native camera integration
- Background uploads with persistent, resumable upload queue (survives app kill/restart)
- Local notifications for upload completion
- App icon and splash screen
- Chromecast support
- No iOS build is currently packaged/released (the underlying web app runs fine in iOS Safari, but
  there's no Capacitor iOS project checked in)

**Mobile Features:**

- Camera upload
- Photo library access
- GPS auto-detection
- Portrait/landscape optimization
- Mobile-friendly gallery

**Browser Support:**

- Chrome/Safari/Edge (latest)
- iOS Safari (recent versions)
- Android Chrome (recent versions)

---

### 🎨 Customization & Branding

White-label the application with your brand.

**Configurable Elements:**

- App name
- Brand name
- Logo (upload your own)
- Color scheme (Tailwind config)
- Domain name
- Contact email
- Copyright holder

**Configuration:**

- Environment variables
- No code changes required
- Runtime configuration
- Per-deployment customization

**Example Brands:**

- "Smith Family Photos"
- "Acme Event Gallery"
- "Wedding Memories"
- "Travel Photo Archive"

---

### 🚀 Performance

**Frontend Optimization:**

- Code splitting
- Lazy loading
- Image optimization
- Blurhash placeholders
- Client-side caching
- Vite build optimization

**Backend Optimization:**

- Edge computing (Cloudflare Workers)
- Global CDN
- Database indexing
- Prepared statements
- Efficient queries

**Load Times:**

- Initial page: <2s
- Gallery load: <1s
- Photo view: <500ms
- Upload start: <100ms

**Scalability:**

- Handles millions of requests
- Auto-scales with traffic
- No server management
- Pay-per-use pricing

---

### 🔧 Developer Experience

**Local Development:**

- Hot module replacement (Vite)
- Local database (Wrangler)
- TypeScript type safety
- ESLint + Prettier
- Vitest unit tests
- Playwright e2e tests

**Developer Tools:**

- Extensive logging
- Error tracking ready
- API documentation
- Type definitions
- Migration system

**Extensibility:**

- Modular architecture
- Feature flags
- Plugin system (future)
- API-first design
- Open source ready

---

## Feature Configuration

### Feature Flags

Control optional features with environment variables.

| Feature | Flag | Requirement |
| --------- | ------ | ------------- |
| Email Sending | `canSendEmails` | Mailgun API key |
| Collaborators | `enableCollaborators` | Mailgun API key |
| Favorites | `enableFavorites` | Always enabled |
| Geocoding | `enableGeocoding` | Always enabled |

**Automatic Detection:**

- Features auto-enable when dependencies present
- Graceful degradation when unavailable
- Clear error messages

**Testing Features:**

```bash
# Enable all features
MAILGUN_API_KEY=your_key
MAILGUN_DOMAIN=your_domain

# Disable optional features
# Simply don't set Mailgun vars
```

---

## Feature Roadmap

> Shipped items from earlier versions of this roadmap (bulk ZIP download, photo editing, invite
> links, video storage, analytics dashboard, collaborator system) have been moved to "Recent
> Additions" below rather than left as unchecked boxes.

### Short Term

- [ ] Server-side video transcoding / adaptive bitrate streaming (Cloudflare Stream)
- [ ] QR code event sharing

### Medium Term

- [ ] Real-time collaboration (Durable Objects)
- [ ] Comments on photos
- [ ] Guest book
- [ ] iOS app packaging
- [ ] Auto-generated trip albums (GPS + date clustering)

### Long Term

- [ ] Photo contests/voting
- [ ] Monetization (paid events)

### Community Requested

- Submit feature requests via GitHub Issues
- Vote on existing requests
- Contribute via pull requests

---

## Feature Comparison

### vs. Google Photos

✅ Self-hosted, privacy-first
✅ Event-based organization
✅ Collaboration system
✅ White-label branding
✅ AI-powered semantic search (Workers AI captions + embeddings)
✅ Face grouping / People
✅ Trash with restore + Archive
✅ Duplicate detection
✅ Memories ("on this day")
✅ Albums (cross-event collections)
✅ Auto-backup (folder sync on Android)
❌ No auto-generated trip albums (yet)

### vs. SmugMug

✅ Free and open source  
✅ Easier setup  
✅ API-first architecture  
❌ No pro photography features  
❌ No client proofing  

---

## Usage Examples

### Wedding Photography

1. Create event: "Smith Wedding 2024"
2. Set password for family access
3. Invite photographer as collaborator
4. Share invite link with guests
5. Collect photos from all attendees
6. Share gallery with password

### Family Vacation

1. Create event: "Hawaii 2024"
2. Add GPS coordinates
3. Upload photos daily
4. Tag favorite moments
5. Share public link with relatives
6. Download all originals

### Corporate Event

1. Create private event
2. Invite team as collaborators
3. Multiple uploaders during event
4. Analytics on engagement
5. Export high-res photos
6. Archive after 30 days

### Photography Portfolio

1. Create public events per shoot
2. Showcase best work
3. Client galleries with passwords
4. Track photo favorites
5. SEO-optimized galleries
6. White-label with your brand

---

## Accessibility Features

**Keyboard Navigation:**

- Tab through interface
- Arrow keys in gallery
- Escape to close modals
- Enter to confirm actions

**Screen Reader Support:**

- ARIA labels
- Alt text on images
- Semantic HTML
- Focus management

**Visual Accessibility:**

- High contrast mode support
- Configurable font sizes
- Color-blind friendly
- Clear focus indicators

**Future Improvements:**

- Voice commands
- Auto-captions for photos
- High contrast theme
- Dyslexia-friendly font

---

## Feature Support Matrix

| Feature | Web | Android (Native) | Admin |
| --------- | ----- | -------- | ------- |
| View photos | ✅ | ✅ | ✅ |
| Upload photos | ✅ | ✅ | ✅ |
| Auto-backup (folder sync) | ❌ | ✅ | ✅ |
| Image/video editing | ✅ | ✅ | ✅ |
| Auto Enhance | ✅ | ✅ | ✅ |
| Favorites | ✅ | ✅ | ✅ |
| Collaborators (upload as invited user) | ✅ | ✅ | ✅ |
| Chromecast | ✅ | ❌ | ✅ |
| Search (unified/semantic) | ✅ | ✅ | ✅ |
| People | ❌ | ❌ | ✅ |
| Albums | ❌ | ❌ | ✅ |
| Trash / Archive | ❌ | ❌ | ✅ |
| Duplicate detection | ❌ | ❌ | ✅ |
| Activity feed | ❌ | ❌ | ✅ |
| Analytics | ❌ | ❌ | ✅ |
| Event management | ❌ | ❌ | ✅ |
| Tags | ✅ | ✅ | ✅ |
| Location / map | ✅ | ✅ | ✅ |

---

## User Feedback

We continuously improve based on user feedback. Common requests:

**Most Requested:**

1. Server-side video transcoding ⏳
2. Comments on photos 🔜
3. iOS app 📅

**Recent Additions:**

- ✅ RAW photo upload support (client-side decoding via libraw-wasm)
- ✅ In-browser image editing (crop/rotate/curves/levels)
- ✅ In-browser video editing (trim/crop/speed)
- ✅ Chromecast support
- ✅ Timeline view
- ✅ Shareable invite links for collaborators
- ✅ Bulk ZIP download
- ✅ Analytics dashboard
- ✅ Trash with restore + Archive
- ✅ Memories ("on this day")
- ✅ Duplicate detection (exact-content)
- ✅ Albums (cross-event collections)
- ✅ Activity feed
- ✅ One-tap Auto Enhance
- ✅ AI-powered unified/semantic search (Workers AI)
- ✅ People (face detection + grouping)
- ✅ Android auto-backup (folder sync)
- ✅ Collaborator system with roles and history

**Share Your Ideas:**

- GitHub Issues
- Email: [See configuration.md for contact]
- Discussions forum

---

## Performance Benchmarks

**Upload Performance:**

- 10MB photo: ~5-8 seconds
- Preview generation: ~1 second
- Metadata extraction: <100ms
- Concurrent uploads: 3 parallel

**Gallery Performance:**

- 1000 photos load: <2 seconds
- Infinite scroll: 50 photos/batch
- Lightbox open: <100ms
- Filter/sort: <500ms

**Database Performance:**

- Event list query: <50ms
- Photo list query: <100ms
- Analytics query: <200ms
- Favorites toggle: <50ms

**Optimization Tips:**

- Enable Cloudflare caching
- Use preview images for thumbnails
- Lazy load below-fold images
- Preload next photo in lightbox

---

## Limitations & Known Issues

**Current Limitations:**

- No server-side video transcoding (videos are stored/served as uploaded; editing is client-side only)
- Max 5GB per R2 upload (multipart)
- D1 database: 1GB max size
- No packaged iOS app (Android native app only; the web app itself works in iOS Safari)

**Known Issues:**

- HEIC upload on some Android browsers
- Safari blur-placeholder rendering quirks
- Slow geocoding for some locations

**Workarounds:**

- Convert HEIC to JPEG before upload
- Use Chrome for best compatibility
- Manually set location if geocoding fails

See GitHub Issues for full bug list and status.

---

## FAQ

**Q: How many photos can I store?**  
A: R2 storage is unlimited. D1 database can hold ~1M photos before hitting 1GB limit.

**Q: Can I customize the look and feel?**  
A: Yes! Edit Tailwind config, upload custom logo, set brand name in env vars.

**Q: Is this truly open source?**  
A: Yes, fully open source. Check LICENSE file for details.

**Q: Can I run this without Cloudflare?**  
A: Not easily. It's designed for Cloudflare Workers + D1 + R2.

**Q: How much does it cost to run?**  
A: Cloudflare free tier covers ~100K photos/month. Paid plans start at $5/month.

**Q: Can I migrate from Google Photos?**  
A: Not yet. Migration tool is planned for future release.

**Q: Is there a hosted version?**  
A: Not officially. This is self-hosted software.

**Q: How do I contribute?**  
A: See CONTRIBUTING.md for guidelines!

---

For more information:

- [Configuration Guide](configuration.md)
- [API Documentation](api-reference.md)
- [Architecture Overview](architecture.md)
- [Contributing Guide](contributing.md)
