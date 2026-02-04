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
  password_salt: string;
  password_hash: string;
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
}

// API Request/Response Types
export interface CreateEventRequest {
  name: string;
  password: string;
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
