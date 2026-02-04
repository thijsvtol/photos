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

export const getPhotos = async (slug: string, from?: string, to?: string): Promise<Photo[]> => {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  
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
  height?: number
): Promise<{ uploadId: string; key: string }> => {
  const response = await api.post(
    `/admin/events/${slug}/uploads/start`,
    { photoId, filename, captureTime, width, height },
    { headers: { 'X-Admin-Access': '1' } }
  );
  return response.data;
};

export const getPartUploadUrl = async (
  slug: string,
  photoId: string,
  uploadId: string,
  partNumber: number
): Promise<{ uploadUrl: string; partNumber: number }> => {
  const response = await api.post(
    `/admin/events/${slug}/uploads/${photoId}/parts`,
    { uploadId, partNumber },
    { headers: { 'X-Admin-Access': '1' } }
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
