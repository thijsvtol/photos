export interface Event {
  id: number;
  slug: string;
  name: string;
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

export interface CreateEventRequest {
  name: string;
  password: string;
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
}
