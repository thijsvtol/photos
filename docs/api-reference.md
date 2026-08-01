# API Documentation

Complete REST API reference for the photo sharing application (Cloudflare Worker, `apps/worker`).

## Base URL

```text
Production: https://<your-domain>
Development: http://localhost:8787
```

Almost all API routes are mounted under `/api/*`. `/media/*`, `/sitemap.xml`, and `/robots.txt` are
the only exceptions (they intentionally live outside `/api` since they're not JSON endpoints).

## Authentication

There are three independent auth mechanisms, used depending on the route:

1. **Cloudflare Access** (web admin routes): Cloudflare Access sits in front of `/admin*` and issues
   a `Cf-Access-Jwt-Assertion` header once a user authenticates via your configured identity
   provider. The worker reads the authenticated user's email from Access-provided headers.
2. **JWT bearer tokens** (mobile app): after completing the Cloudflare Access flow via
   `/api/mobile-login`, the mobile app receives a signed JWT (see
   [mobile-oauth.md](mobile-oauth.md)) and sends it as `Authorization: Bearer <token>` on
   subsequent requests.
3. **Per-event session cookie** (public password-protected events): `POST /api/events/:slug/login`
   verifies the event password and sets an `HttpOnly` session cookie (and returns a portable
   `eventSessionToken` for native clients that can't rely on cookies).

Admin status is derived from the `ADMIN_EMAILS` environment variable (comma-separated email list),
not a database flag.

## API Endpoints

### Auth

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/auth/login` | Cloudflare Access | Triggers Access authentication, then redirects to `return_to` (defaults to `/favorites`) |
| GET | `/api/auth/logout` | - | Redirects to `/cdn-cgi/access/logout` to clear the Access session |
| POST | `/api/events/:slug/login` | - | Verifies an event's password; sets a session cookie and returns `{ success, eventSessionToken }` |
| POST | `/api/admin/logout` | Admin | Clears the admin session |

### Events & Photos (Public)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/events` | optional | Lists events visible to the caller (public events to everyone; private/collaborators-only events filtered by admin status and `event_collaborators`; password-protected public events require an active session) |
| GET | `/api/events/:slug` | optional | Event details |
| GET | `/api/events/:slug/photos` | optional | Lists photos for an event |
| GET | `/api/events/:slug/photos/:photoId` | optional | Single photo details |
| GET | `/api/map/photos` | optional | All photos with GPS coordinates, for the map view |
| GET | `/api/tags` | - | Lists all tags |
| GET | `/api/timeline` | optional | Chronological, paginated feed of photos/videos across all accessible events |
| GET | `/api/events/by-tag/:tagSlug` | - | Lists events associated with a tag |
| GET | `/api/photos/featured` | - | Featured photos for the landing page |
| GET | `/api/photos/most-favorited` | - | Most-favorited photos |
| POST | `/api/photos/:photoId/favorite` | - | Public-facing favorite toggle used on the landing page (separate from the authenticated favorites API below) |

**Example - `GET /api/events` (shape, not exhaustive):**

```json
{
  "events": [
    {
      "id": 1,
      "slug": "summer-festival-2024",
      "name": "Summer Festival 2024",
      "inferred_date": "2024-07-15",
      "created_at": "2024-01-01T00:00:00Z",
      "visibility": "public",
      "requires_password": false,
      "latest_upload": "2024-07-16T09:12:00Z"
    }
  ]
}
```

### Media (Password/Access Gated)

Served from `apps/worker/src/routes/media.ts`, backed directly by R2. Supports HTTP `Range`
requests (single range) for video scrubbing.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/media/:slug/preview/:photoId` | Client-generated preview (max 1920px JPEG for images; original bytes for video) |
| GET | `/media/:slug/original/:photoId` | Full-resolution / original file |
| GET | `/media/:slug/ig/:photoId` | Legacy path kept only for backward compatibility with old links; no new files are written here (see [image-processing.md](image-processing.md)) |

---

### Admin - Events, Photos, Analytics & Tags

All admin endpoints require Cloudflare Access authentication (or a valid mobile JWT bearer token)
and are mounted under `/api/admin`.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/admin/events` | Create a new event |
| PUT | `/api/admin/events/:slug` | Update event (name, description, password, visibility, ...) |
| DELETE | `/api/admin/events/:slug` | Delete an event and cascade-delete its photos |
| PUT | `/api/admin/events/:slug/location` | Set/update event GPS location |
| POST | `/api/admin/events/:slug/tags` | Set the tags assigned to an event |
| POST | `/api/admin/events/:slug/regenerate-thumbnails` | Re-run thumbnail/preview generation for an event's photos |
| POST | `/api/admin/events/:slug/geocode-photos` | Reverse-geocode all GPS-tagged photos in an event |
| GET | `/api/admin/events/:slug/stats` | Event-specific analytics |
| GET | `/api/admin/stats` | Dashboard-wide statistics |
| POST | `/api/admin/events/:slug/uploads/start` | Start a multipart upload for a photo or video |
| PUT | `/api/admin/events/:slug/uploads/:photoId/parts/:partNumber` | Upload one multipart part |
| POST | `/api/admin/events/:slug/uploads/:photoId/complete` | Finish a multipart upload |
| POST | `/api/admin/events/:slug/uploads/:photoId/cancel` | Abort an in-progress multipart upload |
| PUT | `/api/admin/photos/:photoId/featured` | Toggle a photo's featured status |
| PUT | `/api/admin/photos/:photoId/replace` | Replace a photo's original/preview file (used by the in-app editors) |
| DELETE | `/api/admin/photos/:photoId` | Delete a single photo |
| POST | `/api/admin/photos/bulk-delete` | Delete multiple photos at once |
| POST | `/api/admin/photos/bulk-copy` | Copy photos into another event |
| PATCH | `/api/admin/photos/bulk-location` | Bulk-update GPS location for multiple photos |
| POST | `/api/admin/tags` | Create a tag |
| PUT | `/api/admin/tags/:id` | Update a tag |
| DELETE | `/api/admin/tags/:id` | Delete a tag |

**Example - `PUT /api/admin/photos/:photoId/replace`:** accepts either a legacy
`multipart/form-data` body (fields `original`/`preview`) or, on native platforms where multipart
uploads are unreliable in the WebView, a raw `application/octet-stream` body with a `?target=preview`
or `?target=original` query parameter.

---

### Collaborators & Invite Links

**Note:** Email invitations require the `enableCollaborators` feature flag (Mailgun configured);
shareable invite links work without Mailgun.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/events/:slug/collaborators` | Admin/collaborator | List collaborators for an event |
| POST | `/api/events/:slug/collaborators` | `invite_create` capability | Invite a collaborator by email (sends invitation email) |
| DELETE | `/api/events/:slug/collaborators/:userEmail` | `collaborator_remove` capability | Remove a collaborator |
| PUT | `/api/events/:slug/collaborators/:userEmail/role` | `role_change` capability | Change a collaborator's role |
| GET | `/api/events/:slug/collaboration-history` | Admin | Audit log of collaborator/invite actions for an event |
| GET | `/api/user/collaborations` | Authenticated | Events the current user collaborates on |
| GET | `/api/users/search` | Admin | Search users (e.g. to invite as a collaborator) |
| POST | `/api/events/:slug/invite-links` | `invite_create` capability | Create a shareable, expirable invite link |
| GET | `/api/events/:slug/invite-links` | `invite_create` capability | List active invite links for an event |
| DELETE | `/api/events/:slug/invite-links/:token` | `invite_revoke` capability | Revoke an invite link |
| POST | `/api/invite/:token/accept` | Authenticated | Accept an invite link, joining the event as a collaborator |

Collaborator permissions are capability-based (e.g. `invite_create`, `collaborator_remove`,
`role_change`, `invite_revoke`) rather than a single flat "collaborator" role - see
`event_collaborators`/`collaboration_history` in the schema and `docs/features.md` for the roles
model.

---

### Favorites & User Profile

**Note:** Requires the `enableFavorites` feature flag (always enabled by default).

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/favorites` | Required | List the current user's favorited photos |
| GET | `/api/favorites/ids` | Required | List just the IDs of favorited photos (cheaper for UI state) |
| POST | `/api/favorites/:photoId` | Required | Favorite a photo |
| DELETE | `/api/favorites/:photoId` | Required | Unfavorite a photo |
| GET | `/api/user/profile` | Optional | Get the current user's profile |
| PUT | `/api/user/profile` | Required | Update the current user's profile |

---

### Batch Download

| Method | Path                    | Auth                    | Description                                            |
| ------ | ----------------------- | ----------------------- | ------------------------------------------------------ |
| POST   | `/api/events/:slug/zip` | Required (event access) | Request a ZIP of selected photos (max 50) for download |

---

### Mobile OAuth

See [mobile-oauth.md](mobile-oauth.md) for the full flow and Cloudflare Access configuration.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/mobile-login` | Cloudflare Access | Landing page shown in-browser after the mobile app opens a login link; immediately redirects to `/api/mobile-auth` |
| GET | `/api/mobile-auth` | Cloudflare Access | Reads the Access-authenticated user, issues a signed JWT, and redirects to the `photos://auth/callback` deep link with the token |

---

### SEO

| Method | Path | Description |
| --- | --- | --- |
| GET | `/sitemap.xml` | XML sitemap of public events |
| GET | `/robots.txt` | Robots file |

---

## Error Responses

All endpoints may return the following error codes:

### 400 Bad Request

```json
{
  "error": "Validation error message"
}
```

### 401 Unauthorized

```json
{
  "error": "Unauthorized"
}
```

### 403 Forbidden

```json
{
  "error": "Insufficient permissions"
}
```

### 404 Not Found

```json
{
  "error": "Resource not found"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

### 503 Service Unavailable

```json
{
  "error": "Feature not available. This feature requires additional configuration.",
  "feature": "enableCollaborators",
  "reason": "Mailgun not configured"
}
```

## Rate Limiting

Currently no rate limiting is implemented. Consider adding:

- Cloudflare Rate Limiting rules
- Custom middleware for per-user limits
- Durable Objects for distributed rate limiting

## CORS

CORS is configured to allow requests from:

- Configured `APP_DOMAIN` in production
- `localhost:*` in development

Allowed methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`

## Webhooks

Currently no webhooks are implemented. Potential use cases:

- Email confirmation callbacks
- Payment processing (if monetization added)
- Third-party integrations

## TypeScript Types

For TypeScript clients, refer to `apps/worker/src/types.ts` and `apps/web/src/types.ts` for the
authoritative, current type definitions - the shapes below are illustrative only and may drift out
of sync with the code over time.

```typescript
interface Event {
  id: number;
  slug: string;
  name: string;
  visibility: 'public' | 'private' | 'collaborators_only';
  description: string | null;
  is_archived: boolean;
  inferred_date: string | null;
  created_at: string;
}

interface Photo {
  id: string; // ULID
  event_id: number;
  original_filename: string;
  media_type: 'photo' | 'video';
  capture_time: string | null;
  uploaded_at: string;
  width: number | null;
  height: number | null;
  is_featured: boolean;
  favorites_count: number;
  // ... EXIF/GPS fields, see apps/worker/src/types.ts
}

interface User {
  email: string;
  name: string | null;
  avatar: string | null;
  isAdmin: boolean;
}
```

## API Client Example

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://your-domain',
  headers: {
    Authorization: `Bearer ${getToken()}`, // mobile app only; web relies on Cloudflare Access + cookies
  },
});

// List events
const { data: events } = await api.get('/api/events');

// Upload a photo (multipart upload flow)
const { data } = await api.post(`/api/admin/events/${slug}/uploads/start`, {
  filename: 'IMG_1234.jpg',
  contentType: 'image/jpeg',
  fileSize: 5242880,
});

// Upload parts directly to R2 via the presigned URLs
for (const part of data.parts) {
  await axios.put(part.url, filePart);
}

// Complete the upload
await api.post(`/api/admin/events/${slug}/uploads/${data.photoId}/complete`, {
  uploadId: data.uploadId,
  parts: completedParts,
});
```

## References

- [Hono Documentation](https://hono.dev/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [API Design Best Practices](https://restfulapi.net/)
