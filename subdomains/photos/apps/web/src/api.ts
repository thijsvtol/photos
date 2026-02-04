import axios from 'axios';
import type { Event, Photo, CreateEventRequest } from './types';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Public API
export const getEvents = async (): Promise<Event[]> => {
  const response = await api.get<{ events: Event[] }>('/events');
  return response.data.events;
};

export const getEvent = async (slug: string): Promise<Event> => {
  const response = await api.get<{ event: Event }>(`/events/${slug}`);
  return response.data.event;
};

export const loginToEvent = async (slug: string, password: string): Promise<void> => {
  await api.post(`/events/${slug}/login`, { password });
};

export const getPhotos = async (slug: string, sort?: string): Promise<Photo[]> => {
  const params = new URLSearchParams();
  if (sort) params.append('sort', sort);
  
  const response = await api.get<{ photos: Photo[] }>(`/events/${slug}/photos?${params.toString()}`);
  return response.data.photos;
};

export const getPhoto = async (slug: string, photoId: string): Promise<Photo> => {
  const response = await api.get<{ photo: Photo }>(`/events/${slug}/photos/${photoId}`);
  return response.data.photo;
};

export const requestZip = async (slug: string, photoIds: string[]): Promise<Blob> => {
  const response = await api.post(`/events/${slug}/zip`, { photoIds }, {
    responseType: 'blob'
  });
  return response.data;
};

// Admin API
export const createEvent = async (data: CreateEventRequest): Promise<Event> => {
  const response = await api.post<{ event: Event }>('/admin/events', data, {
    headers: { 'X-Admin-Access': '1' },
  });
  return response.data.event;
};

export const startUpload = async (
  slug: string,
  photoId: string,
  filename: string,
  captureTime?: string,
  width?: number,
  height?: number,
  iso?: number,
  aperture?: string,
  shutterSpeed?: string,
  focalLength?: string,
  cameraMake?: string,
  cameraModel?: string,
  lensModel?: string
): Promise<{ uploadId: string; key: string }> => {
  const response = await api.post(
    `/admin/events/${slug}/uploads/start`,
    { 
      photoId, filename, captureTime, width, height,
      iso, aperture, shutterSpeed, focalLength,
      cameraMake, cameraModel, lensModel
    },
    { headers: { 'X-Admin-Access': '1' } }
  );
  return response.data;
};

export const uploadPart = async (
  slug: string,
  photoId: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob
): Promise<{ partNumber: number; etag: string }> => {
  const response = await api.put(
    `/admin/events/${slug}/uploads/${photoId}/parts/${partNumber}`,
    chunk,
    { 
      headers: { 
        'X-Admin-Access': '1',
        'X-Upload-Id': uploadId,
        'Content-Type': 'application/octet-stream',
      } 
    }
  );
  return response.data;
};

export const completeUpload = async (
  slug: string,
  photoId: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>
): Promise<void> => {
  await api.post(
    `/admin/events/${slug}/uploads/${photoId}/complete`,
    { uploadId, parts },
    { headers: { 'X-Admin-Access': '1' } }
  );
};

export const regenerateThumbnails = async (slug: string): Promise<{ count: number }> => {
  const response = await api.post(
    `/admin/events/${slug}/regenerate-thumbnails`,
    {},
    { headers: { 'X-Admin-Access': '1' } }
  );
  return response.data;
};

// Helper functions
export const getPreviewUrl = (slug: string, photoId: string): string => {
  return `/media/${slug}/preview/${photoId}.jpg`;
};

export const getIgUrl = (slug: string, photoId: string): string => {
  return `/media/${slug}/ig/${photoId}.jpg`;
};

export const getOriginalUrl = (slug: string, photoId: string): string => {
  return `/media/${slug}/original/${photoId}.jpg`;
};
