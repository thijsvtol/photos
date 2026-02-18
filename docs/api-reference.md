# API Documentation

Complete REST API reference for the photo sharing application.

## Base URL

```
Production: https://<your-domain>
Development: http://localhost:8787
```

## Authentication

All admin endpoints require authentication via Cloudflare Access + JWT token.

### Headers

```http
Authorization: Bearer <jwt_token>
Cookie: CF_Authorization=<cloudflare_token>
```

### Authentication Flow

1. User accesses admin route → Cloudflare Access challenges
2. User authenticates with OAuth provider
3. Cloudflare issues `CF_Authorization` cookie
4. Frontend requests JWT from worker
5. Worker validates CF token, issues JWT
6. Frontend includes JWT in Authorization header

## API Endpoints

### Authentication

#### Check Auth Status

```http
GET /auth/me
```

Returns current user information and admin status.

**Response 200:**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "avatar": "https://...",
  "isAdmin": true
}
```

**Response 401:**
```json
{
  "error": "Unauthorized"
}
```

---

### Events

#### List All Events

```http
GET /events
```

Returns all events with photo counts. Public events visible to all, private events only to admins/collaborators.

**Response 200:**
```json
[
  {
    "id": 1,
    "slug": "summer-festival-2024",
    "title": "Summer Festival 2024",
    "date": "2024-07-15",
    "description": "Annual summer celebration",
    "location": "Central Park",
    "country": "United States",
    "state": "New York",
    "city": "New York",
    "gps_latitude": 40.785091,
    "gps_longitude": -73.968285,
    "photo_count": 142,
    "created_at": "2024-01-01T00:00:00Z",
    "is_password_protected": true,
    "is_public": true,
    "has_access": true
  }
]
```

#### Get Event Details

```http
GET /events/:slug
```

Returns detailed event information including metadata.

**Parameters:**
- `slug` (path) - Event slug

**Response 200:**
```json
{
  "id": 1,
  "slug": "summer-festival-2024",
  "title": "Summer Festival 2024",
  "date": "2024-07-15",
  "description": "Annual summer celebration",
  "location": "Central Park",
  "country": "United States",
  "state": "New York",
  "city": "New York",
  "gps_latitude": 40.785091,
  "gps_longitude": -73.968285,
  "photo_count": 142,
  "tags": ["music", "outdoor", "festival"],
  "created_at": "2024-01-01T00:00:00Z",
  "is_password_protected": true,
  "is_public": true
}
```

**Response 404:**
```json
{
  "error": "Event not found"
}
```

#### Verify Event Password

```http
POST /events/:slug/verify-password
```

Verifies password for protected event and issues access cookie.

**Parameters:**
- `slug` (path) - Event slug

**Request Body:**
```json
{
  "password": "secret123"
}
```

**Response 200:**
```json
{
  "success": true
}
```

Sets cookie: `event_access_<event_id>=<jwt_token>`

**Response 401:**
```json
{
  "error": "Invalid password"
}
```

#### Get Event Photos

```http
GET /events/:slug/photos
```

Returns all photos for an event. Requires password if event is protected.

**Parameters:**
- `slug` (path) - Event slug

**Response 200:**
```json
[
  {
    "id": 1,
    "filename": "IMG_1234.jpg",
    "preview_url": "https://r2.../preview/IMG_1234.jpg",
    "original_url": "https://r2.../original/IMG_1234.jpg",
    "instagram_url": "https://r2.../ig/IMG_1234.jpg",
    "uploaded_at": "2024-07-15T14:23:45Z",
    "uploaded_by": "John Doe",
    "blurhash": "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
    "width": 4032,
    "height": 3024,
    "exif_data": {
      "make": "Apple",
      "model": "iPhone 14 Pro",
      "iso": 64,
      "aperture": 1.78,
      "shutter_speed": "1/120",
      "focal_length": 6.86,
      "taken_at": "2024-07-15T14:23:40Z"
    },
    "gps_latitude": 40.785091,
    "gps_longitude": -73.968285,
    "location": "Central Park",
    "country": "United States",
    "state": "New York",
    "city": "New York",
    "is_favorited": false,
    "media_type": "photo"
  }
]
```

---

### Admin - Events

All admin endpoints require admin authentication.

#### Create Event

```http
POST /admin/events
```

Creates a new event.

**Request Body:**
```json
{
  "title": "Summer Festival 2024",
  "slug": "summer-festival-2024",
  "date": "2024-07-15",
  "description": "Annual summer celebration",
  "location": "Central Park",
  "country": "United States",
  "state": "New York",
  "city": "New York",
  "gps_latitude": 40.785091,
  "gps_longitude": -73.968285,
  "password": "secret123",
  "is_public": true
}
```

**Response 201:**
```json
{
  "id": 1,
  "slug": "summer-festival-2024",
  "message": "Event created successfully"
}
```

**Response 400:**
```json
{
  "error": "Event with this slug already exists"
}
```

#### Update Event

```http
PUT /admin/events/:slug
```

Updates an existing event.

**Parameters:**
- `slug` (path) - Event slug

**Request Body:** (all fields optional)
```json
{
  "title": "Summer Festival 2024 (Updated)",
  "description": "New description",
  "location": "New Location",
  "password": "new_password",
  "is_public": false
}
```

**Response 200:**
```json
{
  "message": "Event updated successfully"
}
```

#### Delete Event

```http
DELETE /admin/events/:slug
```

Deletes an event and all associated photos.

**Parameters:**
- `slug` (path) - Event slug

**Query Parameters:**
- `confirm` (required) - Must be "true"

**Response 200:**
```json
{
  "message": "Event and all photos deleted successfully"
}
```

**Response 400:**
```json
{
  "error": "Please confirm deletion by passing confirm=true"
}
```

---

### Admin - Photos

#### Start Multipart Upload

```http
POST /admin/events/:slug/uploads/start
```

Initiates a multipart upload for a photo or video.

**Parameters:**
- `slug` (path) - Event slug

**Request Body:**
```json
{
  "filename": "IMG_1234.jpg",
  "contentType": "image/jpeg",
  "fileSize": 5242880,
  "uploadType": "original",
  "blurhash": "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
  "width": 4032,
  "height": 3024,
  "exifData": {
    "make": "Apple",
    "model": "iPhone 14 Pro"
  },
  "gpsData": {
    "latitude": 40.785091,
    "longitude": -73.968285
  }
}
```

**Response 200:**
```json
{
  "uploadId": "abc123",
  "photoId": 1,
  "key": "original/IMG_1234.jpg",
  "parts": [
    {
      "partNumber": 1,
      "url": "https://r2.../upload-url-part-1"
    },
    {
      "partNumber": 2,
      "url": "https://r2.../upload-url-part-2"
    }
  ]
}
```

#### Complete Multipart Upload

```http
POST /admin/events/:slug/uploads/:photoId/complete
```

Completes a multipart upload.

**Parameters:**
- `slug` (path) - Event slug
- `photoId` (path) - Photo ID

**Query Parameters:**
- `preview` (optional) - Set to "true" for preview upload

**Request Body:**
```json
{
  "uploadId": "abc123",
  "parts": [
    {
      "partNumber": 1,
      "etag": "etag-1"
    },
    {
      "partNumber": 2,
      "etag": "etag-2"
    }
  ]
}
```

**Response 200:**
```json
{
  "success": true,
  "url": "https://r2.../original/IMG_1234.jpg"
}
```

#### Update Photo

```http
PUT /admin/photos/:id
```

Updates photo metadata.

**Parameters:**
- `id` (path) - Photo ID

**Request Body:**
```json
{
  "location": "Central Park, New York",
  "gps_latitude": 40.785091,
  "gps_longitude": -73.968285
}
```

**Response 200:**
```json
{
  "message": "Photo updated successfully"
}
```

#### Delete Photo

```http
DELETE /admin/photos/:id
```

Deletes a photo and its files from R2.

**Parameters:**
- `id` (path) - Photo ID

**Response 200:**
```json
{
  "message": "Photo deleted successfully"
}
```

---

### Admin - Analytics

#### Get Statistics

```http
GET /admin/analytics/stats
```

Returns overall statistics.

**Response 200:**
```json
{
  "totalEvents": 15,
  "totalPhotos": 3421,
  "totalUsers": 42,
  "totalFavorites": 892,
  "totalCollaborations": 28
}
```

#### Get Event Statistics

```http
GET /admin/analytics/events
```

Returns per-event statistics.

**Response 200:**
```json
[
  {
    "slug": "summer-festival-2024",
    "title": "Summer Festival 2024",
    "date": "2024-07-15",
    "photo_count": 142,
    "collaborator_count": 5,
    "favorite_count": 38
  }
]
```

#### Get User Statistics

```http
GET /admin/analytics/users
```

Returns per-user statistics.

**Response 200:**
```json
[
  {
    "email": "user@example.com",
    "name": "John Doe",
    "favorite_count": 24,
    "collaboration_count": 3
  }
]
```

#### Get Popular Photos

```http
GET /admin/analytics/popular-photos
```

Returns most favorited photos.

**Query Parameters:**
- `limit` (optional, default: 10) - Number of results

**Response 200:**
```json
[
  {
    "id": 156,
    "filename": "IMG_5678.jpg",
    "preview_url": "https://...",
    "event_title": "Summer Festival 2024",
    "event_slug": "summer-festival-2024",
    "favorite_count": 15
  }
]
```

---

### Admin - Tags

#### Get All Tags

```http
GET /admin/tags
```

Returns all tags with usage counts.

**Response 200:**
```json
[
  {
    "id": 1,
    "name": "music",
    "event_count": 8
  },
  {
    "id": 2,
    "name": "outdoor",
    "event_count": 12
  }
]
```

#### Create Tag

```http
POST /admin/tags
```

Creates a new tag.

**Request Body:**
```json
{
  "name": "music"
}
```

**Response 201:**
```json
{
  "id": 1,
  "message": "Tag created successfully"
}
```

#### Delete Tag

```http
DELETE /admin/tags/:id
```

Deletes a tag and removes all associations.

**Parameters:**
- `id` (path) - Tag ID

**Response 200:**
```json
{
  "message": "Tag deleted successfully"
}
```

#### Assign Tag to Event

```http
POST /admin/tags/:tagId/events/:eventId
```

Associates a tag with an event.

**Parameters:**
- `tagId` (path) - Tag ID
- `eventId` (path) - Event ID

**Response 200:**
```json
{
  "message": "Tag assigned to event successfully"
}
```

#### Remove Tag from Event

```http
DELETE /admin/tags/:tagId/events/:eventId
```

Removes tag association from event.

**Parameters:**
- `tagId` (path) - Tag ID
- `eventId` (path) - Event ID

**Response 200:**
```json
{
  "message": "Tag removed from event successfully"
}
```

---

### Admin - Utilities

#### Reverse Geocode

```http
POST /admin/geocode/reverse
```

Converts GPS coordinates to location information.

**Request Body:**
```json
{
  "latitude": 40.785091,
  "longitude": -73.968285
}
```

**Response 200:**
```json
{
  "location": "Central Park",
  "country": "United States",
  "state": "New York",
  "city": "New York"
}
```

#### Regenerate Thumbnail

```http
POST /admin/photos/:id/regenerate-thumbnail
```

Regenerates Instagram-sized thumbnail for a photo.

**Parameters:**
- `id` (path) - Photo ID

**Response 200:**
```json
{
  "success": true,
  "url": "https://r2.../ig/IMG_1234.jpg"
}
```

---

### Collaborators

**Note:** Requires `enableCollaborators` feature flag (Mailgun configured).

#### Get Event Collaborators

```http
GET /collaborators/:slug
```

Returns all collaborators for an event.

**Parameters:**
- `slug` (path) - Event slug

**Response 200:**
```json
[
  {
    "email": "user@example.com",
    "name": "John Doe",
    "avatar": "https://...",
    "invited_at": "2024-07-01T10:00:00Z",
    "accepted_at": "2024-07-02T14:30:00Z",
    "status": "accepted"
  }
]
```

#### Invite Collaborator

```http
POST /collaborators/:slug/invite
```

Sends collaboration invitation email.

**Parameters:**
- `slug` (path) - Event slug

**Request Body:**
```json
{
  "email": "newuser@example.com"
}
```

**Response 200:**
```json
{
  "message": "Invitation sent successfully"
}
```

**Response 400:**
```json
{
  "error": "User is already a collaborator"
}
```

#### Accept Invitation

```http
POST /collaborators/:slug/accept
```

Accepts a collaboration invitation.

**Parameters:**
- `slug` (path) - Event slug

**Response 200:**
```json
{
  "message": "Invitation accepted successfully"
}
```

#### Remove Collaborator

```http
DELETE /collaborators/:slug/:email
```

Removes a collaborator from an event.

**Parameters:**
- `slug` (path) - Event slug
- `email` (path) - Collaborator email (URL encoded)

**Response 200:**
```json
{
  "message": "Collaborator removed successfully"
}
```

#### Create Invite Link

```http
POST /collaborators/:slug/invite-link
```

Creates a shareable invitation link.

**Parameters:**
- `slug` (path) - Event slug

**Request Body:**
```json
{
  "expiresIn": 7,
  "maxUses": 10
}
```

**Response 201:**
```json
{
  "token": "abc123def456",
  "url": "https://your-domain/events/summer-festival-2024/join/abc123def456",
  "expiresAt": "2024-07-08T10:00:00Z"
}
```

#### Accept Invite Link

```http
POST /collaborators/:slug/join/:token
```

Accepts invitation via shareable link.

**Parameters:**
- `slug` (path) - Event slug
- `token` (path) - Invite token

**Response 200:**
```json
{
  "message": "Successfully joined event as collaborator"
}
```

**Response 400:**
```json
{
  "error": "Invite link has expired"
}
```

---

### Favorites

**Note:** Requires `enableFavorites` feature flag (always enabled by default).

#### Get User Favorites

```http
GET /favorites
```

Returns all photos favorited by current user.

**Response 200:**
```json
[
  {
    "id": 156,
    "filename": "IMG_5678.jpg",
    "preview_url": "https://...",
    "event_title": "Summer Festival 2024",
    "event_slug": "summer-festival-2024",
    "favorited_at": "2024-07-20T15:30:00Z"
  }
]
```

#### Toggle Favorite

```http
POST /favorites/:photoId/toggle
```

Adds or removes a photo from favorites.

**Parameters:**
- `photoId` (path) - Photo ID

**Response 200:**
```json
{
  "favorited": true
}
```

#### Get Event Favorites

```http
GET /events/:slug/favorites
```

Returns favorite status for all photos in an event (for current user).

**Parameters:**
- `slug` (path) - Event slug

**Response 200:**
```json
{
  "156": true,
  "157": false,
  "158": true
}
```

---

### SEO

#### Get Sitemap

```http
GET /sitemap.xml
```

Returns XML sitemap of all public events.

**Response 200:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://your-domain/events/summer-festival-2024</loc>
    <lastmod>2024-07-15</lastmod>
    <priority>0.8</priority>
  </url>
</urlset>
```

#### Get Robots.txt

```http
GET /robots.txt
```

Returns robots.txt file.

**Response 200:**
```
User-agent: *
Allow: /
Sitemap: https://your-domain/sitemap.xml
```

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

For TypeScript clients, refer to `types.ts` in both `apps/web/src/` and `apps/worker/src/` for complete type definitions.

Key types:

```typescript
interface Event {
  id: number;
  slug: string;
  title: string;
  date: string;
  description: string | null;
  location: string | null;
  // ... more fields
}

interface Photo {
  id: number;
  filename: string;
  preview_url: string;
  original_url: string;
  // ... more fields
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
    'Authorization': `Bearer ${getToken()}`
  }
});

// Get events
const events = await api.get('/events');

// Upload photo
const { data } = await api.post(`/admin/events/${slug}/uploads/start`, {
  filename: 'IMG_1234.jpg',
  contentType: 'image/jpeg',
  fileSize: 5242880
});

// Upload parts to R2
for (const part of data.parts) {
  await axios.put(part.url, filePart);
}

// Complete upload
await api.post(`/admin/events/${slug}/uploads/${data.photoId}/complete`, {
  uploadId: data.uploadId,
  parts: completedParts
});
```

## References

- [Hono Documentation](https://hono.dev/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [API Design Best Practices](https://restfulapi.net/)
