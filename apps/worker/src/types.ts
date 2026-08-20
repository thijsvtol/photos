// Cloudflare Worker Environment Bindings
export interface Env {
  DB: D1Database;
  PHOTOS_BUCKET: R2Bucket;
  // Workers AI binding — used only by the batch-limited enrichment cron
  // (runAiEnrichment in scheduled.ts), never per-request, to stay within the
  // free 10,000-neurons/day allocation. See aiEnrichment.ts. Optional in the
  // type (always present at runtime via wrangler.toml's [ai] binding) so
  // existing test Env mocks don't all need updating.
  AI?: Ai;
  /** Optional: max photos the AI enrichment cron processes per hourly tick
   *  (see aiEnrichment.ts). Defaults to 50; clamped to 200. Raise to clear a
   *  backlog faster — the job self-throttles to the free neuron allocation. */
  AI_ENRICHMENT_BATCH_SIZE?: string;
  EVENT_COOKIE_SECRET: string;
  ADMIN_SHARED_SECRET?: string;
  ADMIN_EMAILS?: string; // Comma-separated list of admin emails
  MAILGUN_API_KEY?: string; // Optional: Mailgun API key for sending email notifications
  MAILGUN_DOMAIN?: string; // Optional: Mailgun domain for sending emails
  ENVIRONMENT?: string;
  JWT_SECRET?: string; // JWT secret for mobile OAuth tokens
  /** Optional: set to 'debug' to re-enable verbose per-request debug/info
   *  logging (see logger.ts). Unset in production so only WARN+ is logged. */
  LOG_LEVEL?: string;
}

// Database Models
export interface Event {
  id: number;
  slug: string;
  name: string;
  password_salt: string | null;
  password_hash: string | null;
  inferred_date: string | null;
  visibility: 'public' | 'private' | 'collaborators_only';
  created_at: string;
}

export interface Photo {
  id: string;
  event_id: number;
  original_filename: string;
  file_type: string; // MIME type: 'image/jpeg', 'image/png', 'video/mp4', or 'raw/<ext>' (e.g. 'raw/cr2') for camera RAW photos
  capture_time: string;
  uploaded_at: string;
  uploaded_by: string | null; // Uploader's email (matches users.email for the uploader_name JOIN and notification-exclusion logic)
  width: number | null;
  height: number | null;
  iso: number | null;
  aperture: string | null;
  shutter_speed: string | null;
  focal_length: string | null;
  camera_make: string | null;
  camera_model: string | null;
  lens_model: string | null;
  latitude: number | null;
  longitude: number | null;
  favorites_count: number;
  blur_placeholder: string | null;
  is_featured: number;
    cache_version: number;
  source_photo_id: string | null;
  source_event_slug: string | null;
  /** Named people tagged on this photo (auto-detected + manual) — populated only by the single
   *  photo-detail route (GET /api/events/:slug/photos/:photoId), see getPhotoPeople(). */
  people?: { id: number; name: string }[];
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export interface EventWithTags extends Event {
  tags?: Tag[];
}

// API Request/Response Types
export interface CreateEventRequest {
  name: string;
  password?: string;
  slug?: string;
  visibility?: 'public' | 'private' | 'collaborators_only';
}

export interface LoginRequest {
  password: string;
}

export interface StartUploadRequest {
  photoId: string;
  filename: string;
  fileType?: string; // MIME type
  captureTime?: string;
  width?: number;
  height?: number;
  iso?: number;
  aperture?: string;
  shutterSpeed?: string;
  focalLength?: string;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  latitude?: number;
  longitude?: number;
  blurPlaceholder?: string;
  fileHash?: string; // SHA-256 of the original file (images/RAW only), for duplicate detection
}

export interface UploadPartRequest {
  partNumber: number;
  uploadId: string;
}

export interface CompleteUploadRequest {
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}

export interface ZipRequest {
  photoIds: string[];
}

// Session data stored in cookies
export interface EventSession {
  eventSlug: string;
  authenticated: boolean;
  timestamp: number;
}

// User from Cloudflare Access JWT
export interface User {
  id: string; // sub claim from JWT
  email: string;
  name?: string;
}

// Cloudflare Access JWT payload
export interface CloudflareAccessJWT {
  sub: string; // User ID
  email: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  iss: string;
  aud: string[];
  exp: number;
  iat: number;
}

// User database model
export interface DBUser {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_login: string;
}

// User favorite in database
export interface UserFavorite {
  user_email: string;
  photo_id: string;
  event_id: number;
  created_at: string;
}

export type CollaboratorRole = 'viewer' | 'uploader' | 'editor' | 'admin';

// Event collaborator in database
export interface EventCollaborator {
  event_id: number;
  user_email: string;
  invited_at: string;
  role: CollaboratorRole;
}

// Event collaborator with user info
export interface CollaboratorWithUser {
  event_id: number;
  user_email: string;
  email: string;
  name: string | null;
  invited_at: string;
  role: CollaboratorRole;
  cover_photo_id?: string | null;
  cover_file_type?: string | null;
  cover_cache_version?: number | null;
  cover_event_slug?: string | null;
  person_id?: number | null;
  person_name?: string | null;
}

// Request to invite a collaborator
export interface InviteCollaboratorRequest {
  email: string;
  role?: CollaboratorRole;
}

// Collaboration history action types
export type CollaborationActionType = 'invite' | 'accept' | 'decline' | 'remove' | 'upload';

// Collaboration history in database
export interface CollaborationHistory {
  id: number;
  event_id: number;
  user_email: string;
  action_type: CollaborationActionType;
  target_user_email: string | null;
  metadata: string | null; // JSON string
  created_at: string;
}

// Collaboration history with user names (for display)
export interface CollaborationHistoryWithUsers {
  id: number;
  event_id: number;
  user_email: string;
  user_name: string | null;
  user_email_display: string;
  action_type: CollaborationActionType;
  target_user_email: string | null;
  target_user_name: string | null;
  target_user_email_display: string | null;
  metadata: any; // Parsed JSON
  created_at: string;
}
// Invite link in database
export interface InviteLink {
  id: number;
  token: string;
  event_id: number;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  use_count: number;
  role: CollaboratorRole;
}

// Invite link with creator info
export interface InviteLinkWithCreator extends InviteLink {
  creator_name: string | null;
  event_name: string | null;
  event_slug: string | null;
}