// Cloudflare Worker Environment Bindings
export interface Env {
  DB: D1Database;
  PHOTOS_BUCKET: R2Bucket;
  EVENT_COOKIE_SECRET: string;
  ADMIN_SHARED_SECRET?: string;
  ADMIN_EMAILS?: string; // Comma-separated list of admin emails
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
  user_id: string;
  photo_id: string;
  event_id: number;
  created_at: string;
}
