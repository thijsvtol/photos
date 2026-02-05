export interface Tag {
  id: number;
  name: string;
  slug: string;
  description: string | null;
}

export interface Event {
  id: number;
  slug: string;
  name: string;
  inferred_date: string | null;
  created_at: string;
  requires_password: boolean;
  preview_photo_id: string | null;
  tags?: Tag[];
  description?: string | null;
  is_archived?: boolean;
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
  latitude: number | null;
  longitude: number | null;
  favorites_count: number;
  blur_placeholder: string | null;
  is_featured: boolean;
}

export interface CreateEventRequest {
  name: string;
  password?: string;
  slug?: string;
}

export interface UpdateEventRequest {
  name?: string;
  password?: string;
  description?: string;
}

export interface AdminStats {
  totalEvents: number;
  totalPhotos: number;
  totalFavorites: number;
  storageBytes: number;
  publicEvents: number;
  privateEvents: number;
}

export interface EventStats {
  photoCount: number;
  photosWithGPS: number;
  photosWithoutGPS: number;
  featuredCount: number;
  totalFavorites: number;
  topFavorites: Array<{ id: string; original_filename: string; favorites_count: number }>;
  cameraModels: Array<{ camera_model: string; count: number }>;
}

export interface CreateTagRequest {
  name: string;
  slug?: string;
  description?: string;
}

export interface UpdateTagRequest {
  name?: string;
  slug?: string;
  description?: string;
}

// Upload queue item for persistence in IndexedDB
// Note: File objects can be stored in IndexedDB directly
export interface UploadQueueItem {
  id: string;
  eventSlug: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  photoId?: string;
  uploadId?: string;
  parts?: Array<{ partNumber: number; etag: string }>;
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
