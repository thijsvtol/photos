import axios from 'axios';
import type { Event, Photo, CreateEventRequest, Tag, AdminStats, EventStats, UpdateEventRequest, CreateTagRequest, UpdateTagRequest } from './types';

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

export const adminLogout = async (): Promise<void> => {
  await api.post('/admin/logout', {}, {
    headers: { 'X-Admin-Access': '1' },
  });
  // Clear admin session from localStorage
  localStorage.removeItem('isAdmin');
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

// Tags API
export const getTags = async (): Promise<Tag[]> => {
  const response = await api.get<{ tags: Tag[] }>('/tags');
  return response.data.tags;
};

export const setEventTags = async (slug: string, tagIds: number[]): Promise<void> => {
  await api.post(
    `/admin/events/${slug}/tags`,
    { tagIds },
    { headers: { 'X-Admin-Access': '1' } }
  );
};

export const getEventsByTag = async (tagSlug: string): Promise<Event[]> => {
  const response = await api.get<{ events: Event[] }>(`/events/by-tag/${tagSlug}`);
  return response.data.events;
};

// Favorites API
export const incrementFavorite = async (photoId: string): Promise<{ favorites_count: number }> => {
  const response = await api.post<{ favorites_count: number }>(`/photos/${photoId}/favorite`);
  return response.data;
};

export const getMostFavorited = async (limit: number = 20): Promise<Photo[]> => {
  const response = await api.get<{ photos: Photo[] }>(`/photos/most-favorited?limit=${limit}`);
  return response.data.photos;
};

export const getFeaturedPhotos = async (limit: number = 10): Promise<Photo[]> => {
  const response = await api.get<{ photos: Photo[] }>(`/photos/featured?limit=${limit}`);
  return response.data.photos;
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

export const setPhotoFeatured = async (photoId: string, isFeatured: boolean): Promise<void> => {
  const response = await fetch(`/api/admin/photos/${photoId}/featured`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isFeatured }),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to update featured status');
};

export const setEventLocation = async (slug: string, latitude: number, longitude: number): Promise<{ updated_count: number }> => {
  const response = await fetch(`/api/admin/events/${slug}/location`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude }),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to set event location');
  return response.json();
};

export const geocodeEventPhotos = async (slug: string): Promise<{ updated: number; total: number }> => {
  const response = await fetch(`/api/admin/events/${slug}/geocode-photos`, {
    method: 'POST',
    headers: { 'X-Admin-Access': '1' },
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to geocode photos');
  return response.json();
};

// Admin Stats API
export const getAdminStats = async (): Promise<AdminStats> => {
  const response = await api.get<AdminStats>('/admin/stats', {
    headers: { 'X-Admin-Access': '1' },
  });
  return response.data;
};

export const getEventStats = async (slug: string): Promise<EventStats> => {
  const response = await api.get<EventStats>(`/admin/events/${slug}/stats`, {
    headers: { 'X-Admin-Access': '1' },
  });
  return response.data;
};

// Event Management API
export const updateEvent = async (slug: string, data: UpdateEventRequest): Promise<void> => {
  await api.put(`/admin/events/${slug}`, data, {
    headers: { 'X-Admin-Access': '1' },
  });
};

export const deleteEvent = async (slug: string): Promise<{ success: boolean; deletedPhotos: number }> => {
  const response = await api.delete<{ success: boolean; deletedPhotos: number }>(`/admin/events/${slug}`, {
    headers: { 'X-Admin-Access': '1' },
  });
  return response.data;
};

// Photo Management API
export const deletePhoto = async (photoId: string): Promise<void> => {
  await api.delete(`/admin/photos/${photoId}`, {
    headers: { 'X-Admin-Access': '1' },
  });
};

// Tag Management API
export const createTag = async (data: CreateTagRequest): Promise<Tag> => {
  const response = await api.post<{ tag: Tag }>('/admin/tags', data, {
    headers: { 'X-Admin-Access': '1' },
  });
  return response.data.tag;
};

export const updateTag = async (id: number, data: UpdateTagRequest): Promise<void> => {
  await api.put(`/admin/tags/${id}`, data, {
    headers: { 'X-Admin-Access': '1' },
  });
};

export const deleteTag = async (id: number): Promise<void> => {
  await api.delete(`/admin/tags/${id}`, {
    headers: { 'X-Admin-Access': '1' },
  });
};
