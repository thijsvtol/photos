// Cloudflare Worker Environment Bindings
export interface Env {
  DB: D1Database;
  PHOTOS_BUCKET: R2Bucket;
  EVENT_COOKIE_SECRET: string;
  ADMIN_SHARED_SECRET?: string;
  ADMIN_EMAILS?: string; // Comma-separated list of admin emails
  MAILGUN_API_KEY?: string; // Optional: Mailgun API key for sending email notifications
  MAILGUN_DOMAIN?: string; // Optional: Mailgun domain for sending emails
  ENVIRONMENT?: string;
}

// Database Models
export interface Event {
  id: number;
  slug: string;
  name: string;
  password_salt: string | null;
  password_hash: string | null;
  inferred_date: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  event_id: number;
  original_filename: string;
  file_type: string; // MIME type: 'image/jpeg' or 'video/mp4'
  capture_time: string;
  uploaded_at: string;
  uploaded_by: string | null; // User ID who uploaded the photo
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

// Event collaborator in database
export interface EventCollaborator {
  event_id: number;
  user_email: string;
  invited_at: string;
}

// Event collaborator with user info
export interface CollaboratorWithUser {
  event_id: number;
  user_email: string;
  email: string;
  name: string | null;
  invited_at: string;
}

// Request to invite a collaborator
export interface InviteCollaboratorRequest {
  email: string;
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
