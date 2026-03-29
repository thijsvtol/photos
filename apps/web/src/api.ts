import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { Event, Photo, CreateEventRequest, Tag, AdminStats, EventStats, UpdateEventRequest, CreateTagRequest, UpdateTagRequest, CollaboratorRole } from './types';
import type { User } from './contexts/AuthContext';
import { MobileAuthService } from './services/mobileAuth';
import { config } from './config';
import SafDirectory from './services/safDirectory';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  // Only use credentials in browser, not in native app
  withCredentials: !Capacitor.isNativePlatform(),
});

// Add bearer token for mobile requests
api.interceptors.request.use(async (config) => {
  if (Capacitor.isNativePlatform()) {
    const token = await MobileAuthService.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Debug logging in dev
if (import.meta.env.DEV || Capacitor.isNativePlatform()) {
  console.log('[API] Base URL:', import.meta.env.VITE_API_URL || '/api');
  console.log('[API] Is Native:', Capacitor.isNativePlatform());
  
  // Log all requests
  api.interceptors.request.use((config) => {
    console.log('[API] Request:', config.method?.toUpperCase(), config.url, 'Full URL:', (config.baseURL || '') + (config.url || ''));
    return config;
  });
  
  // Log all responses
  api.interceptors.response.use(
    (response) => {
      console.log('[API] Response:', response.status, response.config.url);
      return response;
    },
    (error) => {
      console.error('[API] Error:', error.message, error.config?.url);
      if (error.response) {
        console.error('[API] Response data:', typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : error.response.data);
      }
      return Promise.reject(error);
    }
  );
}

// Add response interceptor to handle token expiration
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Skip redirect if user is intentionally logging out
      const isLoggingOut = sessionStorage.getItem('logging_out') === 'true';
      if (isLoggingOut) {
        return Promise.reject(error);
      }
      
      // Handle mobile platform differently
      if (Capacitor.isNativePlatform()) {
        // Clear the invalid token
        await MobileAuthService.clearToken();
        // Redirect to home page where they can re-authenticate
        window.location.href = '/';
        return Promise.reject(error);
      }
      
      // For web: Save current location and redirect to login
      const currentPath = window.location.pathname + window.location.search + window.location.hash;
      const returnTo = encodeURIComponent(currentPath);
      
      // Store in sessionStorage as backup (in case return_to gets lost)
      sessionStorage.setItem('auth_redirect', currentPath);
      
      // Redirect to login with return path
      window.location.href = `/api/auth/login?return_to=${returnTo}`;
      
      // Prevent further error handling
      return new Promise(() => {}); // Never resolves, as we're redirecting
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
export const getPreviewUrl = (slug: string, photoId: string, fileType?: string, cacheVersion?: number): string => {
  const isVideo = fileType === 'video/mp4';
  const extension = isVideo ? 'mp4' : 'jpg';
  const relativePath = `/media/${slug}/preview/${photoId}.${extension}`;
  const pathWithVersion = cacheVersion !== undefined ? `${relativePath}?v=${cacheVersion}` : relativePath;
  
  // In native app (Capacitor), use full production domain for media files
  if (Capacitor.isNativePlatform()) {
    const domain = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`;
    return `${domain}${pathWithVersion}`;
  }
  
  return pathWithVersion;
};

export const getOriginalUrl = (slug: string, photoId: string, fileType?: string, cacheVersion?: number): string => {
  const isVideo = fileType === 'video/mp4';
  const extension = isVideo ? 'mp4' : 'jpg';
  const relativePath = `/media/${slug}/original/${photoId}.${extension}`;
  const pathWithVersion = cacheVersion !== undefined ? `${relativePath}?v=${cacheVersion}` : relativePath;
  
  // In native app (Capacitor), use full production domain for media files
  if (Capacitor.isNativePlatform()) {
    const domain = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`;
    return `${domain}${pathWithVersion}`;
  }
  
  return pathWithVersion;
};

// Download functions that trigger browser downloads
export const downloadPhoto = async (url: string, filename: string): Promise<void> => {
  try {
    const isNative = Capacitor.isNativePlatform();
    console.log('[Download] Starting download for:', url);
    console.log('[Download] Is native platform:', isNative);
    console.log('[Download] Filename:', filename);
    
    // Native app: Use Capacitor Filesystem API
    if (isNative) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }
      
      console.log('[Download] Fetched successfully, converting to blob');
      const blob = await response.blob();
      
      console.log('[Download] Converting to base64');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          if (result) {
            const base64String = result.split(',')[1];
            resolve(base64String);
          } else {
            reject(new Error('Failed to convert to base64'));
          }
        };
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(blob);
      });
      
      // Get custom download path from localStorage, or use default
      const customPath = localStorage.getItem('download_path') || '/storage/emulated/0/Download';
      console.log('[Download] Custom path:', customPath);
      
      try {
        let result;
        
        // Check if it's a content:// URI (from folder picker)
        if (customPath.startsWith('content://')) {
          console.log('[Download] Using SafDirectory plugin for content:// URI');
          // Use SafDirectory plugin to write to SAF tree URI
          // Detect mime type from filename
          const mimeType = filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
          result = await SafDirectory.writeFile({
            treeUri: customPath,
            filename: filename,
            data: base64,
            mimeType: mimeType
          });
          console.log('[Download] File saved via SAF:', result.uri);
          alert(`Photo saved: ${filename}`);
        } else {
          // Traditional filesystem path
          const fullPath = `${customPath}/${filename}`;
          console.log('[Download] Writing file to filesystem path:', fullPath);
          result = await Filesystem.writeFile({
            path: fullPath,
            data: base64,
            directory: Directory.ExternalStorage,
            recursive: true
          });
          console.log('[Download] File saved:', result.uri);
          alert(`Photo saved to: ${filename}`);
        }
      } catch (error) {
        // Fallback to Documents if custom path fails
        console.warn('[Download] Custom path failed, falling back to Documents', error);
        const result = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Documents,
          recursive: true
        });
        console.log('[Download] File saved to Documents:', result.uri);
        alert(`Photo saved to Documents: ${filename}`);
      }
    } else {
      // Browser: Use traditional download
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
    }
  } catch (error) {
    console.error('[Download] Error:', error);
    alert(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
};

export const downloadOriginal = async (slug: string, photoId: string): Promise<void> => {
  console.log('[downloadOriginal] Called with slug:', slug, 'photoId:', photoId);
  const url = getOriginalUrl(slug, photoId);
  console.log('[downloadOriginal] URL:', url);
  await downloadPhoto(url, `${slug}_${photoId}_original.jpg`);
};

export const downloadSmall = async (slug: string, photoId: string): Promise<void> => {
  console.log('[downloadSmall] Called with slug:', slug, 'photoId:', photoId);
  // Download the preview version (1920px)
  const url = getPreviewUrl(slug, photoId);
  console.log('[downloadSmall] URL:', url);
  await downloadPhoto(url, `${slug}_${photoId}_small.jpg`);
};

export const downloadInstagram = async (slug: string, photoId: string): Promise<void> => {
  console.log('[downloadInstagram] Called with slug:', slug, 'photoId:', photoId);
  const isNative = Capacitor.isNativePlatform();

  try {
    // Fetch the original image
    const originalUrl = getOriginalUrl(slug, photoId);
    console.log('[downloadInstagram] Fetching original:', originalUrl);
    const response = await fetch(originalUrl);
    if (!response.ok) throw new Error(`Failed to fetch original: ${response.statusText}`);
    const originalBlob = await response.blob();

    // Process into an Instagram-optimised image via canvas
    const { processForInstagram } = await import('./imageUtils');
    const objectUrl = URL.createObjectURL(originalBlob);
    let igBlob: Blob;
    try {
      igBlob = await processForInstagram(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    const filename = `${slug}_${photoId}_instagram.jpg`;

    if (isNative) {
      // Native app: convert blob to base64 and save via Capacitor Filesystem
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          if (result) {
            resolve(result.split(',')[1]);
          } else {
            reject(new Error('Failed to convert to base64'));
          }
        };
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(igBlob);
      });

      const customPath = localStorage.getItem('download_path') || '/storage/emulated/0/Download';

      try {
        await Filesystem.writeFile({
          path: `${customPath}/${filename}`,
          data: base64,
          directory: Directory.ExternalStorage,
          recursive: true,
        });
        alert(`Instagram photo saved: ${filename}`);
      } catch {
        await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Documents,
          recursive: true,
        });
        alert(`Instagram photo saved to Documents: ${filename}`);
      }
    } else {
      // Browser: use a temporary object URL
      const downloadUrl = URL.createObjectURL(igBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    }
  } catch (error) {
    console.error('[downloadInstagram] Error:', error);
    alert(`Instagram download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
};

/**
 * Download a ZIP file (works on both native and web platforms)
 */
export const downloadZip = async (zipBlob: Blob, filename: string): Promise<void> => {
  try {
    const isNative = Capacitor.isNativePlatform();
    console.log('[Download ZIP] Starting download');
    console.log('[Download ZIP] Is native platform:', isNative);
    console.log('[Download ZIP] Filename:', filename);
    console.log('[Download ZIP] Blob size:', zipBlob.size, 'bytes');

    if (isNative) {
      // Native app: Use Capacitor Filesystem API
      console.log('[Download ZIP] Converting blob to base64');
      
      console.log('[Download ZIP] Converting to base64');
      
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          if (result) {
            const base64String = result.split(',')[1];
            resolve(base64String);
          } else {
            reject(new Error('Failed to convert to base64'));
          }
        };
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(zipBlob);
      });

      // Get custom download path from localStorage, or use default
      const customPath = localStorage.getItem('download_path') || '/storage/emulated/0/Download';
      const fullPath = `${customPath}/${filename}`;
      
      console.log('[Download ZIP] Writing file to:', fullPath);
      
      try {
        // Try to write to external storage with full path
        const result = await Filesystem.writeFile({
          path: fullPath,
          data: base64,
          directory: Directory.ExternalStorage,
          recursive: true
        });
        
        console.log('[Download ZIP] File saved:', result.uri);
        alert(`ZIP file saved to: ${customPath}/${filename}`);
      } catch (error) {
        // Fallback to Documents if external storage fails
        console.warn('[Download ZIP] External storage failed, falling back to Documents', error);
        const result = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Documents,
          recursive: true
        });
        console.log('[Download ZIP] File saved to Documents:', result.uri);
        alert(`ZIP file saved to Documents: ${filename}`);
      }
    } else {
      // Browser: Use traditional download
      console.log('[Download ZIP] Using browser download');
      const url = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      console.log('[Download ZIP] Browser download complete');
    }
  } catch (error) {
    console.error('[Download ZIP] Error:', error);
    alert(`ZIP download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
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

export const bulkDeletePhotos = async (photoIds: string[]): Promise<{ deletedCount: number; totalRequested: number }> => {
  const response = await api.post<{ deletedCount: number; totalRequested: number; errors?: any[] }>(
    '/admin/photos/bulk-delete',
    { photoIds },
    { headers: getAdminHeaders() }
  );
  return response.data;
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
    `/events/${eventSlug}/collaborators`
  );
  return response.data.collaborators;
};

export const inviteCollaborator = async (eventSlug: string, email: string, role?: CollaboratorRole) => {
  const response = await api.post(
    `/events/${eventSlug}/collaborators`,
    { email, role }
  );
  return response.data;
};

export const updateCollaboratorRole = async (eventSlug: string, userEmail: string, role: CollaboratorRole) => {
  const response = await api.put(
    `/events/${eventSlug}/collaborators/${userEmail}/role`,
    { role }
  );
  return response.data;
};

export const removeCollaborator = async (eventSlug: string, userEmail: string) => {
  await api.delete(`/events/${eventSlug}/collaborators/${userEmail}`);
};

// Invite Links API
export const createInviteLink = async (eventSlug: string, role?: CollaboratorRole) => {
  const response = await api.post<{ inviteLink: import('./types').InviteLink }>(
    `/events/${eventSlug}/invite-links`,
    { role }
  );
  return response.data.inviteLink;
};

export const getInviteLinks = async (eventSlug: string) => {
  const response = await api.get<{ inviteLinks: import('./types').InviteLink[] }>(`/events/${eventSlug}/invite-links`);
  return response.data.inviteLinks;
};

export const revokeInviteLink = async (eventSlug: string, token: string) => {
  await api.delete(`/events/${eventSlug}/invite-links/${token}`);
};

export const acceptInvite = async (token: string) => {
  const response = await api.post<{ success: boolean; eventSlug: string; eventName: string }>(
    `/invite/${token}/accept`
  );
  return response.data;
};

export const getUserCollaborations = async () => {
  const response = await api.get<{ 
    collaborations: Array<{ 
      event_id: number; 
      event_slug: string; 
      event_name: string; 
      can_upload: boolean;
      invited_at: string;
    }> 
  }>('/user/collaborations');
  return response.data;
};

export const updateUserProfile = async (data: { name?: string }) => {
  const response = await api.put<{ user: User }>('/user/profile', data);
  return response.data.user;
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

export const replacePhoto = async (_slug: string, photoId: string, originalBlob: Blob, previewBlob: Blob): Promise<void> => {
  const formData = new FormData();
  formData.append('original', originalBlob, 'original.jpg');
  formData.append('preview', previewBlob, 'preview.jpg');
  await api.put(
    `/admin/photos/${photoId}/replace`,
    formData,
    {
      headers: getAdminHeaders(),
    }
  );
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
