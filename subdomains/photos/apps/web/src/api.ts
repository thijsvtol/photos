import axios from 'axios';
import type { Event, Photo, CreateEventRequest, Tag, AdminStats, EventStats, UpdateEventRequest, CreateTagRequest, UpdateTagRequest } from './types';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Add response interceptor to handle token expiration
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired - prompt user to re-authenticate
      const shouldReauth = window.confirm(
        'Your session has expired. Would you like to login again?'
      );
      if (shouldReauth) {
        // Redirect through logout to clear expired token
        window.location.href = '/cdn-cgi/access/logout?redirect_uri=' + 
          encodeURIComponent(window.location.pathname);
      }
    }
    return Promise.reject(error);
  }
);

// Helper to get admin headers
const getAdminHeaders = () => {
  const headers: Record<string, string> = {
    'X-Admin-Access': '1',
  };
  
  // In development, add the shared secret
  if (import.meta.env.DEV) {
    headers['X-Admin-Secret'] = 'dev-admin-secret';
  }
  
  return headers;
};

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
    headers: getAdminHeaders(),
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
    headers: getAdminHeaders(),
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
  lensModel?: string,
  latitude?: number,
  longitude?: number,
  blurPlaceholder?: string,
  isPreview: boolean = false,
  fileType?: string
): Promise<{ uploadId: string; key: string }> => {
  const response = await api.post(
    `/admin/events/${slug}/uploads/start`,
    { 
      photoId, filename, captureTime, width, height,
      iso, aperture, shutterSpeed, focalLength,
      cameraMake, cameraModel, lensModel,
      latitude, longitude, blurPlaceholder,
      isPreview, fileType
    },
    { headers: getAdminHeaders() }
  );
  return response.data;
};

export const uploadPart = async (
  slug: string,
  photoId: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob,
  isPreview: boolean = false,
  fileType?: string
): Promise<{ partNumber: number; etag: string }> => {
  const response = await api.put(
    `/admin/events/${slug}/uploads/${photoId}/parts/${partNumber}${isPreview ? '?preview=true' : ''}`,
    chunk,
    { 
      headers: { 
        ...getAdminHeaders(),
        'X-Upload-Id': uploadId,
        'X-File-Type': fileType || 'image/jpeg',
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
  parts: Array<{ partNumber: number; etag: string }>,
  isPreview: boolean = false
): Promise<void> => {
  await api.post(
    `/admin/events/${slug}/uploads/${photoId}/complete${isPreview ? '?preview=true' : ''}`,
    { uploadId, parts },
    { headers: getAdminHeaders() }
  );
};

export const regenerateThumbnails = async (slug: string): Promise<{ count: number }> => {
  const response = await api.post(
    `/admin/events/${slug}/regenerate-thumbnails`,
    {},
    { headers: getAdminHeaders() }
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
    { headers: getAdminHeaders() }
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
export const getPreviewUrl = (slug: string, photoId: string, fileType?: string): string => {
  const isVideo = fileType === 'video/mp4';
  const extension = isVideo ? 'mp4' : 'jpg';
  return `/media/${slug}/preview/${photoId}.${extension}`;
};

export const getOriginalUrl = (slug: string, photoId: string, fileType?: string): string => {
  const isVideo = fileType === 'video/mp4';
  const extension = isVideo ? 'mp4' : 'jpg';
  return `/media/${slug}/original/${photoId}.${extension}`;
};

// Download functions that trigger browser downloads
export const downloadPhoto = async (url: string, filename: string): Promise<void> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Download error:', error);
    throw error;
  }
};

export const downloadOriginal = (slug: string, photoId: string): void => {
  const url = getOriginalUrl(slug, photoId);
  downloadPhoto(url, `${slug}_${photoId}_original.jpg`);
};

export const downloadSmall = (slug: string, photoId: string): void => {
  // Download the preview version (1920px)
  const url = getPreviewUrl(slug, photoId);
  downloadPhoto(url, `${slug}_${photoId}_small.jpg`);
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
    headers: getAdminHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to geocode photos');
  return response.json();
};

// Admin Stats API
export const getAdminStats = async (): Promise<AdminStats> => {
  const response = await api.get<AdminStats>('/admin/stats', {
    headers: getAdminHeaders(),
  });
  return response.data;
};

export const getEventStats = async (slug: string): Promise<EventStats> => {
  const response = await api.get<EventStats>(`/admin/events/${slug}/stats`, {
    headers: getAdminHeaders(),
  });
  return response.data;
};

// Event Management API
export const updateEvent = async (slug: string, data: UpdateEventRequest): Promise<void> => {
  await api.put(`/admin/events/${slug}`, data, {
    headers: getAdminHeaders(),
  });
};

export const deleteEvent = async (slug: string): Promise<{ success: boolean; deletedPhotos: number }> => {
  const response = await api.delete<{ success: boolean; deletedPhotos: number }>(`/admin/events/${slug}`, {
    headers: getAdminHeaders(),
  });
  return response.data;
};

// Photo Management API
export const deletePhoto = async (photoId: string): Promise<void> => {
  await api.delete(`/admin/photos/${photoId}`, {
    headers: getAdminHeaders(),
  });
};

// Tag Management API
export const createTag = async (data: CreateTagRequest): Promise<Tag> => {
  const response = await api.post<{ tag: Tag }>('/admin/tags', data, {
    headers: getAdminHeaders(),
  });
  return response.data.tag;
};

export const updateTag = async (id: number, data: UpdateTagRequest): Promise<void> => {
  await api.put(`/admin/tags/${id}`, data, {
    headers: getAdminHeaders(),
  });
};

export const deleteTag = async (id: number): Promise<void> => {
  await api.delete(`/admin/tags/${id}`, {
    headers: getAdminHeaders(),
  });
};

// User Favorites API
export interface FavoritePhoto extends Photo {
  event_slug: string;
  event_name: string;
  favorited_at: string;
}

export interface FavoriteIdInfo {
  photoId: string;
  eventId: number;
}

export const getUserFavorites = async (): Promise<FavoritePhoto[]> => {
  const response = await api.get<{ favorites: FavoritePhoto[] }>('/favorites');
  return response.data.favorites;
};

export const getUserFavoriteIds = async (): Promise<FavoriteIdInfo[]> => {
  const response = await api.get<{ favorites: FavoriteIdInfo[] }>('/favorites/ids');
  return response.data.favorites;
};

export const addFavorite = async (photoId: string): Promise<void> => {
  await api.post(`/favorites/${photoId}`);
};

export const removeFavorite = async (photoId: string): Promise<void> => {
  await api.delete(`/favorites/${photoId}`);
};

export const toggleFavorite = async (photoId: string, isFavorite: boolean): Promise<void> => {
  if (isFavorite) {
    await removeFavorite(photoId);
  } else {
    await addFavorite(photoId);
  }
};

// Collaborator API
export const getCollaborators = async (eventSlug: string) => {
  const response = await api.get<{ collaborators: import('./types').Collaborator[] }>(
    `/events/${eventSlug}/collaborators`,
    { headers: getAdminHeaders() }
  );
  return response.data.collaborators;
};

export const inviteCollaborator = async (eventSlug: string, email: string) => {
  console.log('[API] inviteCollaborator called:', { eventSlug, email });
  const headers = getAdminHeaders();
  console.log('[API] Headers:', headers);
  
  const response = await api.post(
    `/events/${eventSlug}/collaborators`,
    { email },
    { headers }
  );
  console.log('[API] inviteCollaborator response:', response.data);
  return response.data;
};

export const removeCollaborator = async (eventSlug: string, userId: string) => {
  await api.delete(
    `/events/${eventSlug}/collaborators/${userId}`,
    { headers: getAdminHeaders() }
  );
};

export const getUserCollaborations = async () => {
  const response = await api.get<{ events: Array<{ id: number; slug: string; name: string; inferred_date: string | null; invited_at: string }> }>(
    '/user/collaborations'
  );
  return response.data.events;
};

export const searchUsers = async (query: string) => {
  const response = await api.get<{ users: Array<{ id: string; email: string; name: string | null }> }>(
    '/users/search',
    { 
      params: { q: query },
      headers: getAdminHeaders()
    }
  );
  return response.data.users;
};

export const getCollaborationHistory = async (eventSlug: string) => {
  const response = await api.get<{ 
    history: Array<{
      id: number;
      event_id: number;
      user_id: string;
      user_name: string | null;
      user_email: string;
      action_type: 'invite' | 'accept' | 'decline' | 'remove' | 'upload';
      target_user_id: string | null;
      target_user_name: string | null;
      target_user_email: string | null;
      metadata: any;
      created_at: string;
    }>
  }>(
    `/events/${eventSlug}/collaboration-history`,
    { headers: getAdminHeaders() }
  );
  return response.data.history;
};
