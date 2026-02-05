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
