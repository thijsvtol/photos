export interface Event {
  id: number;
  slug: string;
  name: string;
  inferred_date: string | null;
  created_at: string;
}

export interface UploadQueueItem {
  id: string;
  uri: string;
  filename: string;
  eventSlug: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  width?: number;
  height?: number;
  exif?: any;
}

export interface Config {
  apiEndpoint: string;
  adminSecret: string;
}

export interface UploadResponse {
  uploadId: string;
  key: string;
}

export interface PartUploadResponse {
  partNumber: number;
  etag: string;
}
