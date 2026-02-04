// Cloudflare Worker Environment Bindings
export interface Env {
  DB: D1Database;
  PHOTOS_BUCKET: R2Bucket;
  EVENT_COOKIE_SECRET: string;
  ADMIN_SHARED_SECRET?: string;
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
