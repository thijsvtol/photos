import type { Env } from '../../types';

export interface TestEnv extends Env {
  APP_NAME: string;
  BRAND_NAME: string;
  COPYRIGHT_HOLDER: string;
  APP_DOMAIN: string;
  CONTACT_EMAIL: string;
  ENVIRONMENT: string;
}

export interface EventRecord {
  id: number;
  slug: string;
  name: string;
  inferred_date: string | null;
  created_at: string;
  visibility: 'public' | 'private' | 'collaborators_only';
  password_hash: string | null;
}

export interface PhotoRecord {
  id: string;
  event_id: number;
  original_filename: string;
  file_type: string;
  capture_time: string;
  uploaded_at: string;
  uploaded_by: string | null;
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
  city?: string | null;
  source_photo_id?: string | null;
  source_event_slug?: string | null;
}

export interface FavoriteRecord {
  photo_id: string;
  user_email: string;
}

export interface CollaboratorRecord {
  event_id: number;
  user_email: string;
  role?: 'viewer' | 'uploader' | 'editor' | 'admin';
}
