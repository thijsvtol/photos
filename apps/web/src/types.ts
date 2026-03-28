export interface Tag {
  id: number;
  name: string;
  slug: string;
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
  cities?: string[];
  description?: string | null;
  is_archived?: boolean;
  visibility: 'public' | 'private' | 'collaborators_only';
}

export interface Photo {
  id: string;
  event_id: number;
  event_slug?: string; // Added for featured photos
  event_name?: string; // Added for featured photos
  original_filename: string;
  file_type: string; // MIME type: 'image/jpeg' or 'video/mp4'
  capture_time: string;
  uploaded_at: string;
  uploaded_by: string | null; // User ID who uploaded the photo
  uploader_name?: string | null; // Name of the user who uploaded (joined from users table)
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
  city: string | null;
  favorites_count: number;
  blur_placeholder: string | null;
  is_featured: boolean;
}

export interface CreateEventRequest {
  name: string;
  password?: string;
  slug?: string;
  visibility?: 'public' | 'private' | 'collaborators_only';
}

export interface UpdateEventRequest {
  name?: string;
  password?: string;
  description?: string;
  visibility?: 'public' | 'private' | 'collaborators_only';
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
}

export interface UpdateTagRequest {
  name?: string;
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
  fileType?: string; // MIME type
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
  latitude?: number;
  longitude?: number;
  blurPlaceholder?: string;
  retries?: number; // Number of retry attempts (0-3 before marking failed)
  lastRetryTime?: number; // Timestamp of last retry attempt for exponential backoff
}

export interface Collaborator {
  id: number;
  event_id: number;
  user_id: string;
  email: string;
  name: string | null;
  invited_by: string;
  invited_at: string;
  status: 'pending' | 'accepted' | 'declined';
}

export interface InviteCollaboratorRequest {
  email: string;
}

export interface InviteLink {
  id: number;
  token: string;
  event_id: number;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  use_count: number;
  creator_name?: string | null;
  event_name?: string | null;
  event_slug?: string | null;
}
