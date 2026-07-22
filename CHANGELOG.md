# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.10] - 2026-07-22

### Changed
- Android app release bumped to build 42 (versionName 1.7.10).
- Project package versions synchronized to 1.7.10.
- Web foreground upload path now caps concurrent uploads (`MAX_CONCURRENT_UPLOADS`) to avoid flooding the browser's connection pool and exhausting memory when selecting many/large files.

### Fixed
- Native background upload progress not reflected live in the on-screen upload list (`GlobalUploadIndicator`) — status/progress updates are now mirrored into the in-memory upload manager as they happen instead of only jumping to the final state once the whole batch finishes.

## [1.6.4] - 2026-05-18

### Changed
- Android app release bumped to build 29 (versionName 1.6.4).
- Project package versions synchronized to 1.6.4.
- Event list sorted by most recent photo upload (events with newest uploads appear first).
- Gallery selection mode on touch devices: tapping a photo now toggles selection instead of requiring the small checkbox target.
- Clicked photos load with priority — other pending gallery image loads are aborted to free browser connections for the detail view.

### Fixed
- Ghost "X uploads complete" notification appearing on app start without any uploads — completed items from previous sessions no longer reload from IndexedDB.
- Share button on desktop web doing nothing — added clipboard fallback when Web Share API is unavailable.
- Multi-select on Android app: tapping photos in selection mode was navigating instead of selecting due to tiny checkbox hit target.

## [1.6.3] - 2026-05-18

### Changed
- Android app release bumped to build 28 (versionName 1.6.3).
- Project package versions synchronized to 1.6.3.

### Fixed
- Interrupted uploads stuck forever in "uploading" state after app kill — now reset to pending and retried on restart.
- Upload progress bar flickering on app resume — `resumeAll()` no longer overwrites in-memory state for actively-processing items.
- Analytics sending wrong photo IDs — `parseInt()` on ULID strings was producing incorrect values; now passes string IDs directly.
- GPS coordinates at latitude/longitude 0 (equator/prime meridian) being silently discarded due to falsy `|| undefined` check.
- Potential OOM crash when folder-syncing large video files — `base64ToBlob` now processes data in 512KB chunks instead of allocating a single massive intermediate array.
- Timeline infinite scroll not loading more photos for authenticated users — `setLoading(false)` was deferred until after favorites fetch, causing the IntersectionObserver to miss the sentinel element.
- Folder sync moved from gallery header into event settings modal.

## [1.6.2] - 2026-05-17

### Changed
- Android app release bumped to build 27 (versionName 1.6.2).
- Project package versions synchronized to 1.6.2.
- Timeline page batch size reduced from 200 to 50 photos per load — dramatically fewer DOM nodes and JustifiedGrid instances.
- Timeline scroll handler throttled with requestAnimationFrame — was firing getBoundingClientRect on every scroll event.
- Timeline date grouping memoized to avoid O(n) recomputation on every re-render.
- Folder sync now uses the main upload manager instead of the background sync service — uploads start immediately with full UI progress feedback.

### Fixed
- Photo viewer not updating after deleting a photo — navigation list now drops the deleted photo immediately.
- Gallery scroll position not restored when returning from photo viewer — uses manual scroll restoration with rAF polling until page is tall enough.
- Modal overlays appearing behind sticky navbar on Android — bumped modal z-index above navbar.
- Modals allowing pull-to-refresh when scrolling on Android — added `overscroll-behavior: contain` and body scroll lock to all modal overlays.
- Timeline page freezing or crashing when loading many photos — memoized groupByDate, throttled scroll handler, cached date formatting.
- Folder sync not starting uploads immediately after enabling — only worked after leaving and reopening the app.
- Folder sync uploads returning 404 errors — queue items were missing `photoId` and `fileType`, causing server rejection and video misidentification.
- Upload manager now extracts EXIF/video metadata on-the-fly for folder-sync items that lack it.
- Event creation now navigates directly to the new event's gallery page.
- Console logging stripped from production builds via custom Vite plugin (Vite 8/oxc ignores esbuild.drop).

## [1.6.0] - 2026-05-17

### Added
- System theme option — uses OS light/dark preference by default, with live matchMedia listener for real-time updates.
- Google Photos-style fullscreen photo viewer — tap to toggle overlay, swipe-up info sheet, muted video autoplay with volume toggle.
- Inline photo/video upload directly from event gallery page — drag-and-drop support with floating progress indicator.
- Event creation FAB (floating action button) on events list page for admins.
- Event settings modal accessible from gallery page — edit name, description, visibility, password, tags, collaborators, and admin tools (GPS, geocoding, thumbnail regeneration).
- Video preview fix for Android — renders static poster image on native platform since WebView doesn't reliably load video metadata.

### Changed
- Photo detail page completely rewritten as a fullscreen viewer (no Navbar/Footer) with overlay controls, download menu, and bottom info sheet.
- Theme selector now offers three options: Light, Dark, and System (default).
- Upload workflow moved from dedicated admin page into the gallery page itself.
- Event management (create/edit/delete) moved from admin dashboard into the regular event pages.
- Android app release bumped to build 25 (versionName 1.6.0).
- Project package versions synchronized to 1.6.0.

### Removed
- Admin dashboard page (`/admin`) — all functionality inlined into regular UI.
- Admin upload page (`/admin/events/:slug/upload`) — replaced by inline gallery upload.
- Admin photo manager page (`/admin/events/:slug/photos`) — gallery already has selection mode with bulk actions.
- Admin tag manager page (`/admin/tags`) — tags managed inline when editing events.
- Admin navigation link in navbar.
- Dashboard analytics/statistics display.

### Fixed
- Navbar test suite updated to reflect admin link removal.
- Security staging probe now captures response bodies on failure for better CI diagnostics.
- Staging database re-seeded to restore missing test event data that caused daily CI cron failures.

## [1.5.3] - 2026-05-16

### Added
- Upload retry button on individual failed uploads and "Retry All" button when multiple uploads fail.
- Per-chunk retry logic (3 retries with progressive backoff) — individual chunk failures no longer kill the whole upload.
- `beforeunload` warning when navigating away during active uploads on web.
- Auto-resume failed uploads when network connection is restored (online event).
- Auto-resume failed uploads when tab becomes visible again (visibilitychange event).
- Background sync now works on web platform (previously native-only) for manual sync triggers.

### Changed
- Background sync max retries increased from 3 to 5 with 2s initial backoff (was 1s).
- Failed uploads are automatically retried on page load (previously only pending were resumed).
- Android app release bumped to build 24 (versionName 1.5.3).

## [1.5.2] - 2026-05-16

### Added
- Database migration 017: performance indexes for collaborator lookups, city queries, tag fetching, and preview photo selection.
- Image load error handling with retry button in ProgressiveImage component — failed images show a fallback icon instead of blank space.
- Slug format validation on all public API route parameters — rejects malformed slugs early with 400 status.
- Cache-Control headers on `/api/map/photos` endpoint (5min browser cache, 10min CDN cache).

### Changed
- GET `/api/events` rewritten from N+1 to batch queries — preview photos, cities, and tags fetched in 3 queries total instead of 3 per event.
- Android app release bumped to build 23 (versionName 1.5.2).
- Project package versions synchronized to 1.5.2.

### Fixed
- Event list API performance: eliminated O(3N) database queries (3 per event) with batch fetching pattern.
- ProgressiveImage no longer shows blank space when image fails to load.

### Security
- Route parameter validation prevents malformed slugs from reaching database queries.

## [1.5.1] - 2026-05-14

### Added
- Dedicated `/api/map/photos` backend endpoint — single SQL query returns only GPS-enabled photos from public events with minimal fields, replacing N sequential API calls.
- Marker clustering on map view via react-leaflet-cluster — nearby markers group into clusters with count badges, dramatically improving rendering performance with many locations.
- Lazy loading for popup thumbnail images.

### Changed
- Map page loads in a single API request instead of one request per event (was O(n) sequential HTTP calls).
- Android app release bumped to build 22 (versionName 1.5.1).
- Project package versions synchronized to 1.5.1.

### Fixed
- Map page slow loading with many events/photos — eliminated serial API waterfall and excessive DOM marker rendering.

## [1.5.0] - 2026-05-14

### Added
- Custom video player in photo detail view with tap-to-play/pause, double-tap to seek ±10s, scrubbing progress bar, buffered indicator, and time display.
- Play icon overlay on video cards in gallery — visible on both touch and hover devices.
- Swipe preview now works for videos in photo detail view (shows blurred poster with play icon).
- Seek indicator animations (rewind/fast-forward badges) on double-tap video gestures.
- Fade-in CSS animation for UI overlays.

### Changed
- Video player in detail view replaced with custom controls instead of browser-native controls: tap to play/pause, double-tap left/right to seek, fullscreen button, custom progress bar with scrubber.
- ProgressiveVideo component now shows a play icon overlay and properly detects touch vs hover devices.
- Android app release bumped to build 21 (versionName 1.5.0).
- Project package versions synchronized to 1.5.0.

## [1.4.9] - 2026-05-14

### Changed
- Bumped dependency versions (React 19, Vite 8, Tailwind CSS 4, TypeScript 6, and more).
- Migrated PostCSS config and CSS directives for Tailwind CSS v4 compatibility.
- Converted Vite manualChunks to function syntax for Vite 8/Rolldown.
- Android app release bumped to build 20 (versionName 1.4.9).

## [1.4.8] - 2026-05-14

### Changed
- Android app release bumped to build 19 (versionName 1.4.8).
- Project package versions synchronized to 1.4.8.

### Fixed
- Re-applied mobile image auth fix that was lost during force-push — photos in invite-only events now load correctly on Android app again.
- Bearer token passed as query parameter on native image URLs so `<img>` tags can authenticate.
- Server accepts Bearer token from `?token=` query parameter for mobile image requests.
- Collaborators bypass event password gate when accessing media they have permission to view.

## [1.4.7] - 2026-05-13

### Changed
- Android app release bumped to build 18 (versionName 1.4.7).
- Project package versions synchronized to 1.4.7.

## [1.4.6] - 2026-05-13

### Added
- Viewport-priority image loading — photos near the viewport load first instead of sequentially from top, so scrolled-to images appear instantly.
- Text search in event gallery — filter photos by filename, camera model, lens, city, or date directly from the gallery page.

### Changed
- Android app release bumped to build 17 (versionName 1.4.6).
- Project package versions synchronized to 1.4.6.
- ProgressiveImage component uses IntersectionObserver for on-demand loading instead of eager preloading all images.

### Fixed
- Photos and preview images not loading on Android app for event owners and collaborators — Bearer token now passed as query parameter for native image requests.
- Authenticated collaborators no longer blocked by event password gate when accessing media.
- Server user extraction now accepts Bearer token from query parameter for mobile image requests.

## [1.4.4] - 2026-03-30

### Changed
- Android app release bumped to build 15 (versionName 1.4.4).
- Project package versions synchronized to 1.4.4.

### Fixed
- Admin dashboard storage estimate now counts only unique stored originals and excludes DB-only copied photo references.
- Production media loading regression resolved by applying migration 016 so source photo columns exist for media lookup queries.

## [1.4.2] - 2026-03-29

### Changed
- Android app release bumped to build 13 (versionName 1.4.2).
- Project package versions synchronized to 1.4.2.

### Fixed
- Worker TypeScript strict typing issues in collaborator routes for optional path params and invite-link payload parsing.
- Invite flow in gallery share menu now opens an in-app collaborator invite modal instead of opening social/native share.
- Invite option visibility and role detection in gallery improved to correctly recognize event collaborator/admin permissions across API email field variations.

### Security
- Patched brace-expansion moderate-severity vulnerability in web dependencies via targeted npm overrides:
- brace-expansion@^1.1.7 -> 1.1.13
- brace-expansion@^5.0.2 -> 5.0.5

## [1.4.1] - 2026-03-29

### Added
- Event collaborator role model and capability-based access controls across backend and frontend.
- Roles: viewer, uploader, editor, admin.
- Capability checks for upload, image edit, photo delete, bulk delete, invite create/revoke, collaborator removal, role changes, and featured photo management.
- Collaborator role update endpoint for event admins.

### Changed
- Collaborator and invite API flows now use event capability checks instead of blanket admin-only client behavior.
- Admin photo routes switched to per-event capability checks instead of global admin middleware.
- Last-admin safeguards added for collaborator removal and demotion flows.

### Fixed
- Web build blockers fixed for Android release pipeline:
- ImageEditorModal pixel ratio and required props typing.
- ShareEventButton clipboard fallback handling.
- CollaboratorManager tests updated for role-based collaborator and invite types.
- React hook dependency and lint issues resolved in gallery and photo detail pages.
- Android local build prerequisites and signing flow validated for release artifact generation.

## [1.0.0] - 2024-02-18

### Added
- Initial public release
- Complete photo sharing application with event management
- Admin dashboard with analytics
- Photo upload with EXIF extraction
- GPS metadata and map view for photos
- Batch photo operations (delete, download as ZIP)
- Favorites system for users
- Event collaboration features
- Invite links for event access
- Tag-based event organization
- Mobile app (Capacitor-based Android/iOS)
- Contact form functionality
- Photo watermarking
- Progressive image loading

### Infrastructure
- Cloudflare Workers backend (Hono framework)
- D1 SQLite database
- R2 object storage
- OAuth authentication support
- Comprehensive test suite (115+ tests)
- GitHub Actions CI/CD
- Development environment setup guide

## Types of Changes

When creating a new release, categorize your changes as follows:

- **Added** - New features
- **Changed** - Changes in existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security vulnerability fixes

## Release Process

1. Update this file with changes
2. Update version numbers in `package.json` files
3. Create a git tag: `git tag -a v1.0.0 -m "Version 1.0.0"`
4. Push tag: `git push origin v1.0.0`
5. Create a GitHub Release with release notes

## Versioning Scheme

We use [Semantic Versioning](https://semver.org/):

- **MAJOR** - Incompatible API changes
- **MINOR** - New functionality in backward-compatible manner
- **PATCH** - Backward-compatible bug fixes

Example: `v1.2.3` where:

- `1` = Major version
- `2` = Minor version
- `3` = Patch version

