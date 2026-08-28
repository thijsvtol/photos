import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { Event, Photo, CreateEventRequest, Tag, AdminStats, EventStats, UpdateEventRequest, CreateTagRequest, UpdateTagRequest, CollaboratorRole } from './types';
import type { User } from './contexts/AuthContext';
import { MobileAuthService } from './services/mobileAuth';
import { config } from './config';
import SafDirectory from './services/safDirectory';

const extractApiPathname = (requestUrl?: string): string => {
  if (!requestUrl) return '';

  try {
    if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
      return new URL(requestUrl).pathname;
    }

    return new URL(requestUrl, window.location.origin).pathname;
  } catch {
    return requestUrl;
  }
};

const isEventPasswordFlowRequest = (requestUrl?: string): boolean => {
  const pathname = extractApiPathname(requestUrl);

  // Axios calls in this app use baseURL '/api', but keep this resilient for absolute URLs as well.
  const normalizedPath = pathname.replace(/^\/api/, '');

  return /^\/events\/[^/]+\/login$/.test(normalizedPath)
    || /^\/events\/[^/]+\/photos(?:\/[^/]+)?$/.test(normalizedPath);
};

const extractEventSlugFromApiPath = (requestUrl?: string): string | null => {
  const pathname = extractApiPathname(requestUrl);
  const normalizedPath = pathname.replace(/^\/api/, '');
  const match = normalizedPath.match(/^\/events\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
};

// Chunked upload requests need generous per-request timeouts: without one,
// a stalled connection (common on flaky mobile networks) hangs indefinitely
// instead of failing and letting the chunk-retry logic in uploadManager
// kick in. These comfortably cover a 10MB video chunk / multipart-complete
// call even on a slow connection while still detecting a dead connection in
// bounded time.
const CHUNK_UPLOAD_TIMEOUT_MS = 120_000;
const UPLOAD_COMPLETE_TIMEOUT_MS = 60_000;
// The shared `api` instance has no default timeout (a global one would break
// legitimately long-running endpoints like zip generation and cluster-data
// paging), so the small upload-session calls need their own. Without one, a
// stalled connection at /start hangs the whole upload loop indefinitely
// instead of failing and letting the retry logic recover. These are tiny
// metadata calls, so a short timeout is plenty.
const START_UPLOAD_TIMEOUT_MS = 30_000;

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

    const pathname = extractApiPathname(config.url).replace(/^\/api/, '');
    const eventSlug = extractEventSlugFromApiPath(config.url);

    if (pathname === '/events') {
      const sessions = await MobileAuthService.getAllEventSessionTokens();
      if (Object.keys(sessions).length > 0) {
        config.headers['X-Event-Sessions'] = JSON.stringify(sessions);
      }
    }

    if (eventSlug && !/^\/events\/[^/]+\/login$/.test(pathname)) {
      const eventSessionToken = await MobileAuthService.getEventSessionToken(eventSlug);
      if (eventSessionToken) {
        config.headers['X-Event-Session'] = eventSessionToken;
      }
    }
  }
  return config;
});

// Debug logging in dev only (not native production builds)
if (import.meta.env.DEV) {
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
      if (isEventPasswordFlowRequest(error.config?.url)) {
        return Promise.reject(error);
      }

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
export interface MapPhoto {
  id: string;
  latitude: number;
  longitude: number;
  original_filename: string;
  blur_placeholder?: string | null;
  cache_version?: number;
  file_type: string;
  event_slug: string;
  event_name: string;
}

export const getMapPhotos = async (): Promise<MapPhoto[]> => {
  const response = await api.get<{ photos: MapPhoto[] }>('/map/photos');
  return response.data.photos;
};

export const getEvents = async (): Promise<Event[]> => {
  const response = await api.get<{ events: Event[] }>('/events');
  return response.data.events;
};

export const getEvent = async (slug: string): Promise<Event> => {
  const response = await api.get<{ event: Event }>(`/events/${slug}`);
  return response.data.event;
};

export const loginToEvent = async (slug: string, password: string): Promise<void> => {
  const response = await api.post<{ success: boolean; eventSessionToken?: string }>(`/events/${slug}/login`, { password });

  if (response.data.eventSessionToken) {
    if (Capacitor.isNativePlatform()) {
      await MobileAuthService.setEventSessionToken(slug, response.data.eventSessionToken);
    } else {
      // Stored so Cast (Chromecast) media requests — which run in a separate
      // browser context on the TV with no session cookie — can still
      // authenticate via the ?est= query param fallback (see
      // getCastOriginalUrl/getCastPreviewUrl below).
      localStorage.setItem(`event_session_${slug}`, response.data.eventSessionToken);
    }
  }
};

export const adminLogout = async (): Promise<void> => {
  await api.post('/admin/logout', {}, {
    headers: getAdminHeaders(),
  });
  // Clear admin session from localStorage
  localStorage.removeItem('isAdmin');
};

export const getPhotos = async (slug: string, sort?: string, personIds?: number[]): Promise<Photo[]> => {
  const params = new URLSearchParams();
  if (sort) params.append('sort', sort);
  if (personIds && personIds.length > 0) params.append('people', personIds.join(','));
  
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
  fileType?: string,
  fileHash?: string
): Promise<{ uploadId: string; key: string }> => {
  const response = await api.post(
    `/admin/events/${slug}/uploads/start`,
    { 
      photoId, filename, captureTime, width, height,
      iso, aperture, shutterSpeed, focalLength,
      cameraMake, cameraModel, lensModel,
      latitude, longitude, blurPlaceholder,
      isPreview, fileType, fileHash
    },
    { headers: getAdminHeaders(), timeout: START_UPLOAD_TIMEOUT_MS }
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
      },
      // Without a timeout, a stalled connection (common on flaky mobile
      // networks) hangs indefinitely instead of failing and letting the
      // existing chunk-retry logic kick in.
      timeout: CHUNK_UPLOAD_TIMEOUT_MS,
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
    { headers: getAdminHeaders(), timeout: UPLOAD_COMPLETE_TIMEOUT_MS }
  );
};

/** Cancel an in-progress or not-yet-started upload: aborts the multipart
 *  upload(s) on R2 and deletes the (incomplete) photo row so it never lingers
 *  as a half-uploaded photo. Safe to call even if the upload never reached R2
 *  (e.g. a still-pending item that has no uploadId yet). */
export const cancelUpload = async (
  slug: string,
  photoId: string,
  options: { uploadId?: string; previewUploadId?: string; fileType?: string } = {}
): Promise<void> => {
  await api.post(
    `/admin/events/${slug}/uploads/${photoId}/cancel`,
    options,
    { headers: getAdminHeaders(), timeout: START_UPLOAD_TIMEOUT_MS }
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

export const getTimeline = async (limit: number = 200, cursor?: string): Promise<{ photos: Photo[]; nextCursor: string | null }> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const response = await api.get<{ photos: Photo[]; nextCursor: string | null }>(`/timeline?${params}`);
  return response.data;
};

export interface MemoryYear {
  year: number;
  photos: Array<Photo & { event_slug: string; event_name: string }>;
}

/** "On this day" — photos captured on today's month/day in previous years. */
export const getMemories = async (perYear: number = 6): Promise<MemoryYear[]> => {
  const response = await api.get<{ years: MemoryYear[] }>(`/memories?perYear=${perYear}`);
  return response.data.years;
};

export interface SearchResultPhoto extends Photo {
  event_slug: string;
  event_name: string;
  ai_caption?: string | null;
}

/** Unified search across all accessible events — filename/city/AI caption text, semantically
 *  re-ranked when possible. `personIds` (optional) requires the photo to contain EVERY given
 *  person (not just any of them) — see the worker route's doc comment in routes/public.ts for
 *  why AND, not OR, is the right default. Can be used alone (no `query`) for a pure people
 *  search, or combined with a text query. Returns `hasMore: true` when the server's own `limit`
 *  (or an internal candidate cap) truncated the result set, so callers can show a "showing first
 *  N results" notice instead of silently truncating with no indication. */
export const searchPhotos = async (query: string, limit: number = 60, personIds?: number[]): Promise<{ photos: SearchResultPhoto[]; hasMore: boolean }> => {
  const response = await api.get<{ photos: SearchResultPhoto[]; hasMore?: boolean }>('/search', {
    params: {
      q: query,
      limit,
      ...(personIds && personIds.length > 0 ? { people: personIds.join(',') } : {}),
    },
  });
  return { photos: response.data.photos, hasMore: Boolean(response.data.hasMore) };
};

// Faces / People API
export interface DetectedFaceInput {
  embedding: number[];
  bbox: { x: number; y: number; width: number; height: number };
}

/** Reports client-detected faces for a photo (see faceDetectionQueue.ts). Uses upload permission, not admin-only. */
export const saveFaces = async (eventSlug: string, photoId: string, faces: DetectedFaceInput[]): Promise<void> => {
  await api.post(`/admin/events/${eventSlug}/uploads/${photoId}/faces`, { faces }, { headers: getAdminHeaders() });
};

export interface FacesPendingPhoto {
  id: string;
  file_type: string;
  cache_version: number;
  event_slug: string;
}

/** Batch of photos not yet checked for faces, for the People backfill scan (admin only). */
export const getFacesPendingPhotos = async (limit: number = 10): Promise<{ photos: FacesPendingPhoto[]; remaining: number }> => {
  const response = await api.get<{ photos: FacesPendingPhoto[]; remaining: number }>('/admin/photos/faces-pending', {
    params: { limit },
    headers: getAdminHeaders(),
  });
  return response.data;
};

/** Admin-triggered counterpart to saveFaces(), used for backfilling photos uploaded before the People feature existed. */
export const saveBackfilledFaces = async (photoId: string, faces: DetectedFaceInput[]): Promise<void> => {
  await api.post(`/admin/photos/${photoId}/faces`, { faces }, { headers: getAdminHeaders() });
};

export interface Person {
  id: number;
  name: string | null;
  face_count: number;
  /** DISTINCT photo count (auto-detected faces ∪ manual photo_person_tags) — use this for any
   *  "X photos" display; face_count is a raw photo_faces ROW count (can double-count a person
   *  appearing twice in one photo, and never includes manually-tagged photos) used internally
   *  for centroid-averaging weight, not a reliable photo count. */
  photo_count: number;
  cover_photo_id?: string | null;
  cover_file_type?: string | null;
  cover_cache_version?: number | null;
  cover_event_slug?: string | null;
  linked_user_email?: string | null;
  linked_user_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonPhoto extends Photo {
  event_slug: string;
  event_name: string;
}

export const getPeople = async (includeSingles = false): Promise<Person[]> => {
  const response = await api.get<{ people: Person[] }>('/admin/people', {
    params: includeSingles ? { includeSingles: 1 } : undefined,
    headers: getAdminHeaders(),
  });
  return response.data.people;
};

export interface UnattachedPhoto extends Photo {
  event_slug: string;
  event_name: string;
  /** true when this photo has one or more detected-but-unclustered faces (as opposed to zero
   *  faces detected at all) — see getUnattachedPhotos()'s doc comment in
   *  apps/worker/src/faceClustering.ts for why both cases still qualify as "unattached" but are
   *  worth distinguishing in the UI's messaging. */
  has_unclustered_faces: boolean;
}

/** Fetches ONE PAGE of photos with no person attached at all (neither an auto-detected face
 *  assigned to a person nor a manual tag) — powers the People admin page's "Unattached photos"
 *  view. Cursor-paginated by capture_time, same shape as getTimeline(): pass the previous
 *  response's `nextCursor` to fetch the next page, `null` once exhausted. */
export const getUnattachedPhotos = async (
  cursor: string | null = null,
  limit = 100
): Promise<{ photos: UnattachedPhoto[]; nextCursor: string | null }> => {
  const response = await api.get<{ photos: UnattachedPhoto[]; nextCursor: string | null }>(
    '/admin/people/unattached-photos',
    { params: { ...(cursor ? { cursor } : undefined), limit }, headers: getAdminHeaders() }
  );
  return response.data;
};

/** The named person a redundant unnamed cluster most likely actually is, inferred from the named
 *  people already tagged/identified on that cluster's photos — see
 *  getUnnamedPeopleWithSuggestions() in apps/worker/src/faceClustering.ts. */
export interface UnnamedPersonSuggestion {
  personId: number;
  name: string;
  sharedPhotos: number;
  totalPhotos: number;
  centroidSimilarity: number;
}

/** An unnamed person cluster (name IS NULL) plus, where inferrable, its suggested real identity.
 *  Shares the cover/count fields of `Person` so the same avatar tile renders both. */
export interface UnnamedPerson {
  id: number;
  face_count: number;
  photo_count: number;
  cover_photo_id?: string | null;
  cover_file_type?: string | null;
  cover_cache_version?: number | null;
  cover_event_slug?: string | null;
  suggestion: UnnamedPersonSuggestion | null;
  /** True when `suggestion` is safe to merge in bulk (the "Merge all confident matches" action). */
  confident: boolean;
}

/** Every unnamed person cluster with cover metadata + a suggested identity where the cluster's
 *  photos are already tagged with a named person. Powers the Unattached page's "Unnamed people"
 *  cleanup section. */
export const getUnnamedPeople = async (): Promise<UnnamedPerson[]> => {
  const response = await api.get<{ people: UnnamedPerson[] }>('/admin/people/unnamed', {
    headers: getAdminHeaders(),
  });
  return response.data.people;
};

/** Bulk-merges every high-confidence unnamed cluster into its suggested named person. Capped
 *  server-side per call; returns how many merged and how many confident matches still remain, so
 *  the caller can loop until `remaining` is 0. */
export const mergeUnnamedConfident = async (): Promise<{ merged: number; remaining: number }> => {
  const response = await api.post<{ success: boolean; merged: number; remaining: number }>(
    '/admin/people/merge-unnamed-confident',
    {},
    { headers: getAdminHeaders() }
  );
  return { merged: response.data.merged, remaining: response.data.remaining };
};

export interface ClusterDataFace {
  id: number;
  photoId: string;
  embedding: number[];
  /** Person this face is currently assigned to, or null if still unclustered. Populated when
   *  fetching ALL faces (see getAllFacesForDeepRebuild); used as ground-truth labels by the
   *  read-only "Recognition diagnostics" tool. */
  personId?: number | null;
}

export interface ClusterDataCluster {
  id: number;
  centroidEmbedding: number[];
  faceCount: number;
}

export interface ClusterData {
  faces: ClusterDataFace[];
  clusters: ClusterDataCluster[];
  nextClusterCursor: number | null;
  nextFaceCursor: number | null;
}

/** Fetches ONE PAGE of raw face/cluster data for client-side clustering or merge-suggestion
 *  matching (see faceClusteringClient.ts) — the Worker only ever does cheap I/O plus bounded
 *  per-page marshalling, never the vector-similarity math itself (that math doesn't fit safely
 *  within Cloudflare Workers' 10ms CPU-time limit once a library grows large — see
 *  faceClustering.ts's doc comment for the full history, including why even converting/
 *  serializing an unbounded number of rows in one call is itself unsafe, independent of any
 *  math). Prefer `getFullClusterData()` below unless you specifically need manual pagination
 *  control. Pass `includeFaces: false` to skip the (potentially large) unclustered-faces array
 *  when only cluster centroids are needed (merge-suggestion matching never needs faces). */
export const getClusterData = async (
  includeFaces: boolean,
  afterClusterId = 0,
  afterFaceId = 0,
  unclusteredOnly = true
): Promise<ClusterData> => {
  const response = await api.get<ClusterData>('/admin/people/cluster-data', {
    params: {
      ...(includeFaces ? undefined : { includeFaces: 0 }),
      ...(afterClusterId ? { afterClusterId } : undefined),
      ...(afterFaceId ? { afterFaceId } : undefined),
      ...(unclusteredOnly ? undefined : { unclusteredOnly: 0 }),
    },
    headers: getAdminHeaders(),
  });
  return response.data;
};

/** Loops `getClusterData()` until every page has been fetched, accumulating the FULL dataset in
 *  the browser before returning it — safe because a browser has no per-task CPU-time limit,
 *  unlike the Worker (which can only safely marshal/serialize a bounded number of rows per
 *  call, see getClusterData()'s doc comment). `onProgress` is called after each page (counts of
 *  rows fetched SO FAR, not a percentage — the total isn't known until the last page). */
export const getFullClusterData = async (
  includeFaces: boolean,
  onProgress?: (facesLoaded: number, clustersLoaded: number) => void
): Promise<{ faces: ClusterDataFace[]; clusters: ClusterDataCluster[] }> => {
  const faces: ClusterDataFace[] = [];
  const clusters: ClusterDataCluster[] = [];
  let afterClusterId = 0;
  let afterFaceId = 0;

  for (;;) {
    const page = await getClusterData(includeFaces, afterClusterId, afterFaceId);
    faces.push(...page.faces);
    clusters.push(...page.clusters);
    onProgress?.(faces.length, clusters.length);

    if (page.nextClusterCursor === null && page.nextFaceCursor === null) break;
    afterClusterId = page.nextClusterCursor ?? afterClusterId;
    afterFaceId = page.nextFaceCursor ?? afterFaceId;
  }

  return { faces, clusters };
};

/** Loops `getClusterData()` fetching EVERY face regardless of current cluster assignment
 *  (`unclusteredOnly: false`) — used only by the "Rebuild All (Deep)" full-reclustering flow
 *  (see faceClusteringClient.ts's runDeepRebuildClustering()), which recomputes every person
 *  from scratch using each face's real embedding rather than incrementally trusting whatever
 *  clusters already exist. Cluster centroids aren't needed here (rebuilding ignores them
 *  entirely), so this always calls with `includeFaces: true` and discards the (should-be-empty,
 *  since callers reset clusters first) clusters array. */
export const getAllFacesForDeepRebuild = async (
  onProgress?: (facesLoaded: number) => void
): Promise<ClusterDataFace[]> => {
  const faces: ClusterDataFace[] = [];
  let afterFaceId = 0;

  for (;;) {
    const page = await getClusterData(true, 0, afterFaceId, false);
    faces.push(...page.faces);
    onProgress?.(faces.length);

    if (page.nextFaceCursor === null) break;
    afterFaceId = page.nextFaceCursor;
  }

  return faces;
};

export interface ClusterResult {
  /** null = brand-new cluster (never existed before this pass); otherwise an existing cluster id. */
  clusterId: number | null;
  centroidEmbedding: number[];
  faceCount: number;
  /** photo_faces.id values to assign to this cluster (only the NEWLY assigned ones this pass). */
  addedFaceIds: number[];
  /** Required (and only used) when clusterId is null — becomes the new cluster's cover photo. */
  coverPhotoId?: string;
}

/** Persists client-computed clustering results (see faceClusteringClient.ts's
 *  runClientSideClustering()) — pure I/O on the Worker side, safe regardless of how many faces/
 *  clusters were involved in the client's computation. `rejected` counts results the Worker
 *  refused to write because their centroidEmbedding wasn't the expected length (a defense-in-
 *  depth guard against the exact malformed-embedding corruption incident — see
 *  faceClustering.ts's top-of-file doc comment); those faces stay unclustered and are simply
 *  retried on the next "Cluster Now" pass. */
export const applyClusteringResults = async (results: ClusterResult[]): Promise<{ facesAssigned: number; remaining: number; rejected: number }> => {
  const response = await api.post<{ facesAssigned: number; remaining: number; rejected: number }>(
    '/admin/people/apply-clustering',
    { results },
    { headers: getAdminHeaders() }
  );
  return response.data;
};

export interface LegacyFaceStats {
  legacyFaces: number;
  legacyClusters: number;
  corruptedClusters: number;
}

/** See resetLegacyFaces()'s doc comment (apps/worker/src/faceClustering.ts) — checks whether
 *  any photo_faces/person_clusters rows still use the legacy pre-2026-08 face-api.js embedding
 *  format, which silently breaks clustering/merge-suggestion matching against those rows. */
export const getLegacyFaceStats = async (): Promise<LegacyFaceStats> => {
  const response = await api.get<LegacyFaceStats>('/admin/people/legacy-face-stats', {
    headers: getAdminHeaders(),
  });
  return response.data;
};

/** One-time repair — see resetLegacyFaces() in faceClustering.ts. Deletes legacy-dimension
 *  rows and resets faces_processed_at so affected photos get re-detected by the next
 *  "Scan Library for Faces" pass. */
export const resetLegacyFaces = async (): Promise<{ facesReset: number; clustersRemoved: number }> => {
  const response = await api.post<{ facesReset: number; clustersRemoved: number }>(
    '/admin/people/reset-legacy-faces',
    {},
    { headers: getAdminHeaders() }
  );
  return response.data;
};

/** Unassigns every face and deletes every person cluster — see resetAllClusters()'s doc comment
 *  in apps/worker/src/faceClustering.ts. Used before a full "Rebuild All (Deep)" reclustering
 *  pass; raw face embeddings are never touched, fully recoverable by reclustering again. */
export const resetAllClusters = async (): Promise<{ facesUnassigned: number; clustersDeleted: number }> => {
  const response = await api.post<{ facesUnassigned: number; clustersDeleted: number }>(
    '/admin/people/reset-clusters',
    {},
    { headers: getAdminHeaders() }
  );
  return response.data;
};

/** Fetches the ArcFace ONNX face-recognition model binary (see apps/web/src/faceEmbeddingOnnx.ts)
 *  via the SHARED `api` axios instance rather than a raw `fetch()` — critical because a raw
 *  fetch bypasses this app's auth entirely: native (Capacitor) sessions authenticate via a
 *  Bearer token added by `api`'s request interceptor (there is no cookie to send), and even on
 *  web, `api`'s baseURL is needed for consistency with every other authenticated endpoint. Fixed
 *  2026-08-04 after "Scan Library for Faces" silently marked every photo as processed with ZERO
 *  faces found — every embedding computation was failing (model fetch 401ing) but
 *  `faceDetection.ts`'s per-face try/catch swallowed the error into an empty face list, which
 *  `faceBackfill.ts` then (correctly, for a DIFFERENT reason — see its own doc comment)
 *  persisted as "checked, 0 faces" instead of surfacing the failure.
 *
 *  Fixed AGAIN 2026-08-06: this used to hit `/admin/people/embedding-model` (global-admin-only,
 *  via ADMIN_EMAILS), but the model is fetched for EVERY upload's face detection
 *  (faceDetectionQueue.ts), not just admin actions — so any non-admin collaborator's uploads
 *  silently got zero face detection (the resulting 403 was swallowed by the same best-effort
 *  try/catch above). Moved to `/me/face-embedding-model` (any authenticated user) — see that
 *  route's doc comment in apps/worker/src/routes/me.ts. */
export const getEmbeddingModelBuffer = async (): Promise<ArrayBuffer> => {
  const response = await api.get<ArrayBuffer>('/me/face-embedding-model', {
    responseType: 'arraybuffer',
  });
  return response.data;
};

export const getPerson = async (personId: number): Promise<{ person: Person; photos: PersonPhoto[] }> => {
  const response = await api.get<{ person: Person; photos: PersonPhoto[] }>(`/admin/people/${personId}`, {
    headers: getAdminHeaders(),
  });
  return response.data;
};

export const updatePerson = async (
  personId: number,
  data: { name?: string | null; coverPhotoId?: string | null; linkedUserEmail?: string | null }
): Promise<void> => {
  await api.put(`/admin/people/${personId}`, data, { headers: getAdminHeaders() });
};

/** Merges one or more source people into `targetPersonId`, moving every source photo/face to
 *  the target and deleting the source person records. The target's centroid is recomputed
 *  server-side as a face_count-weighted average of all merged centroids — see
 *  mergeClusters()'s doc comment (apps/worker/src/faceClustering.ts) for why this "teaches" the
 *  target person, improving future automatic clustering rather than leaving a stale centroid. */
export const mergePeople = async (targetPersonId: number, sourcePersonIds: number[]): Promise<{ facesMoved: number }> => {
  const response = await api.post<{ success: boolean; facesMoved: number }>(
    '/admin/people/merge',
    { targetPersonId, sourcePersonIds },
    { headers: getAdminHeaders() }
  );
  return { facesMoved: response.data.facesMoved };
};

/** Manually assigns every detected face on the given photos to `personId` — used to correct a
 *  photo that was never clustered, or clustered under the wrong person. "The model learns from
 *  that": the person's centroid is updated to incorporate each newly assigned face's real
 *  embedding (see assignPhotosToPerson()'s doc comment in apps/worker/src/faceClustering.ts for
 *  the exact drift-safe formula), so the correction improves future automatic clustering too. */
export const assignPhotosToPerson = async (personId: number, photoIds: string[]): Promise<{ assigned: number; skipped: number }> => {
  const response = await api.post<{ assigned: number; skipped: number }>(
    `/admin/people/${personId}/photos`,
    { photoIds },
    { headers: getAdminHeaders() }
  );
  return response.data;
};

export const deletePerson = async (personId: number): Promise<void> => {
  await api.delete(`/admin/people/${personId}`, { headers: getAdminHeaders() });
};

/** Creates a new, empty NAMED person with zero attached photos — lets an admin create someone to
 *  tag right away (via the "Tag people" pickers) without needing to attach/find a photo first.
 *  See the worker route's doc comment (routes/admin/people.ts) for why a zero-vector centroid
 *  can never accidentally attract automatic face-clustering matches. */
export const createPerson = async (name: string): Promise<{ id: number; name: string }> => {
  const response = await api.post<{ success: boolean; id: number; name: string }>(
    '/admin/people',
    { name },
    { headers: getAdminHeaders() }
  );
  return { id: response.data.id, name: response.data.name };
};

/**
 * Resets a single person's auto-detected clustering (unassigns their photo_faces, clears their
 * centroid/face_count) WITHOUT deleting the person record — unlike deletePerson(), their name,
 * linked account, and cover photo are kept, so future automatic clustering re-accumulates under
 * the same identity. See resetSingleCluster()'s doc comment in apps/worker/src/faceClustering.ts.
 */
export const resetPersonCluster = async (personId: number): Promise<{ facesUnassigned: number }> => {
  const response = await api.post<{ success: boolean; facesUnassigned: number }>(
    `/admin/people/${personId}/reset-cluster`,
    {},
    { headers: getAdminHeaders() }
  );
  return { facesUnassigned: response.data.facesUnassigned };
};

/** Lets manual photo tagging directly improve future automatic clustering — see
 *  learnFromManualTags()'s doc comment in apps/worker/src/faceClustering.ts. Safe to run
 *  repeatedly (a no-op once no qualifying tag/face pairs remain).
 *  `taggedPhotosWithNoFaceData`/`taggedPhotosNeverScannedImages`/`taggedPhotosNeverScannedVideos`
 *  explain a "0 faces assigned" result that isn't a bug — most manually-tagged photos (e.g.
 *  bulk-tagged via the Unattached Photos page) simply have no detected face at all to learn
 *  from, and video tags can NEVER get face data (video face detection isn't supported). */
export const learnFromManualTags = async (): Promise<{
  personsUpdated: number;
  facesAssigned: number;
  taggedPhotosWithNoFaceData: number;
  taggedPhotosNeverScannedImages: number;
  taggedPhotosNeverScannedVideos: number;
}> => {
  const response = await api.post<{
    success: boolean;
    personsUpdated: number;
    facesAssigned: number;
    taggedPhotosWithNoFaceData: number;
    taggedPhotosNeverScannedImages: number;
    taggedPhotosNeverScannedVideos: number;
  }>(
    '/admin/people/learn-from-tags',
    undefined,
    { headers: getAdminHeaders() }
  );
  return {
    personsUpdated: response.data.personsUpdated,
    facesAssigned: response.data.facesAssigned,
    taggedPhotosWithNoFaceData: response.data.taggedPhotosWithNoFaceData,
    taggedPhotosNeverScannedImages: response.data.taggedPhotosNeverScannedImages,
    taggedPhotosNeverScannedVideos: response.data.taggedPhotosNeverScannedVideos,
  };
};

/** Resets faces_processed_at for manually-tagged photos that were scanned but found zero
 *  faces (images/RAW only) — see resetFacesForFacelessTaggedPhotos()'s doc comment in
 *  apps/worker/src/faceClustering.ts. Lets the next "Scan Library for Faces" pass re-detect
 *  them with the fixed, full-resolution-original backfill logic (2026-08-06) rather than the
 *  smaller preview image the backfill used to (and may have missed faces on) before that fix. */
export const rescanFacelessTaggedPhotos = async (): Promise<{ photosReset: number }> => {
  const response = await api.post<{ success: boolean; photosReset: number }>(
    '/admin/people/rescan-faceless-tagged-photos',
    undefined,
    { headers: getAdminHeaders() }
  );
  return { photosReset: response.data.photosReset };
};

/** Lightweight list of every NAMED person (regardless of face_count) — used to populate the
 *  "Tag people" picker on PhotoDetail, which only ever offers named people to tag (tagging an
 *  anonymous, un-reviewed cluster wouldn't mean anything to whoever is doing the tagging). */
export interface NamedPerson {
  id: number;
  name: string;
  face_count: number;
}
export const getNamedPeople = async (): Promise<NamedPerson[]> => {
  const response = await api.get<{ people: NamedPerson[] }>('/admin/people', {
    params: { namedOnly: '1' },
    headers: getAdminHeaders(),
  });
  return response.data.people;
};

/** Public (unauthenticated) lightweight list of every NAMED person, id + name only — used by
 *  the Search page's people filter, which (unlike the "Tag people" picker above) is a normal
 *  visitor-facing feature meant for everyone, not just admins — see the worker route's doc
 *  comment in routes/public.ts for why exposing just names here (not face data/linked
 *  accounts/face_count) is intentional and safe. */
export interface PublicNamedPerson {
  id: number;
  name: string;
}
/** Pass `eventSlug` to scope the list to people who appear in that one event (used by the event
 *  gallery's people filter); omit it for the global list (Timeline/Search filter). */
export const getPublicNamedPeople = async (eventSlug?: string): Promise<PublicNamedPerson[]> => {
  const response = await api.get<{ people: PublicNamedPerson[] }>('/people/named', {
    params: eventSlug ? { event: eventSlug } : undefined,
  });
  return response.data.people;
};

/** Replaces the full set of manually-tagged people on a photo (in addition to whichever people
 *  automatic face detection already found — see setManualPhotoPersonTags()'s doc comment in
 *  apps/worker/src/faceClustering.ts). Returns the photo's complete up-to-date people list
 *  (auto-detected + manual, combined and de-duplicated) so the caller can update its UI without
 *  a separate re-fetch of the photo. */
export const tagPeopleOnPhoto = async (photoId: string, personIds: number[]): Promise<{ id: number; name: string }[]> => {
  const response = await api.put<{ success: boolean; people: { id: number; name: string }[] }>(
    `/admin/photos/${photoId}/people`,
    { personIds },
    { headers: getAdminHeaders() }
  );
  return response.data.people;
};

/** Unattaches a single person from a single photo — undoes BOTH a manual tag AND any
 *  automatically-detected face assignment (see removePersonFromPhoto()'s doc comment in
 *  apps/worker/src/faceClustering.ts for why both are needed). Returns the photo's remaining
 *  people list so the caller can update its UI without a separate re-fetch. */
export const removePersonFromPhoto = async (photoId: string, personId: number): Promise<{ id: number; name: string }[]> => {
  const response = await api.delete<{ success: boolean; people: { id: number; name: string }[] }>(
    `/admin/photos/${photoId}/people/${personId}`,
    { headers: getAdminHeaders() }
  );
  return response.data.people;
};

export interface MyPhotosResponse {
  linked: boolean;
  person?: { id: number; displayName: string | null; faceCount: number };
  photos?: PersonPhoto[];
}

/** Backs the Timeline's "Just me" filter toggle — only returns results if an admin has linked
 *  the current account to a person cluster (see PUT /admin/people/:id's linkedUserEmail). Only
 *  the person's FIRST name is ever returned here (full name stays admin-only). */
export const getMyPhotos = async (): Promise<MyPhotosResponse> => {
  const response = await api.get<MyPhotosResponse>('/me/photos');
  return response.data;
};

export interface DeletionsPage {
  deletions: { photoId: string; purgedAt: string }[];
  nextCursor: string | null;
}

/** Deletions feed for the Android folder-sync "delete local when deleted online" reconcile
 *  (see folderSync.ts). Returns photos the current account permanently deleted online (purge-
 *  gated + `deleted_by = me`). Pass `head: true` to fetch just the current head cursor (no rows)
 *  — used at opt-in time so enabling never retroactively deletes files purged before opt-in. */
export const getDeletions = async (cursor?: string | null, head = false): Promise<DeletionsPage> => {
  const params: Record<string, string> = {};
  if (cursor) params.cursor = cursor;
  if (head) params.head = '1';
  const response = await api.get<DeletionsPage>('/me/deletions', { params });
  return response.data;
};



// Helper functions
export const getPreviewUrl = (slug: string, photoId: string, fileType?: string, cacheVersion?: number): string => {
  const isVideo = fileType === 'video/mp4';
  const extension = isVideo ? 'mp4' : 'jpg';
  const relativePath = `/media/${slug}/preview/${photoId}.${extension}`;
  let pathWithVersion = cacheVersion !== undefined ? `${relativePath}?v=${cacheVersion}` : relativePath;
  
  // In native app (Capacitor), use full production domain for media files
  if (Capacitor.isNativePlatform()) {
    const eventSessionToken = localStorage.getItem(`event_session_${slug}`);
    if (eventSessionToken) {
      const separator = pathWithVersion.includes('?') ? '&' : '?';
      pathWithVersion = `${pathWithVersion}${separator}est=${encodeURIComponent(eventSessionToken)}`;
    }

    // Append Bearer token for authenticated media access (img tags can't send headers)
    const bearerToken = localStorage.getItem('mobile_bearer_token');
    if (bearerToken) {
      const separator = pathWithVersion.includes('?') ? '&' : '?';
      pathWithVersion = `${pathWithVersion}${separator}token=${encodeURIComponent(bearerToken)}`;
    }

    const domain = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`;
    return `${domain}${pathWithVersion}`;
  }
  
  return pathWithVersion;
};

export const getOriginalUrl = (slug: string, photoId: string, fileType?: string, cacheVersion?: number): string => {
  const isVideo = fileType === 'video/mp4';
  // RAW originals keep their real extension (e.g. 'raw/cr2' -> 'cr2') — the
  // worker stores/serves them as-is since browsers can't decode RAW anyway;
  // only the preview (always .jpg) is meant for in-app display.
  const isRaw = !!fileType && fileType.startsWith('raw/');
  const extension = isVideo ? 'mp4' : isRaw ? fileType!.slice('raw/'.length) : 'jpg';
  const relativePath = `/media/${slug}/original/${photoId}.${extension}`;
  let pathWithVersion = cacheVersion !== undefined ? `${relativePath}?v=${cacheVersion}` : relativePath;
  
  // In native app (Capacitor), use full production domain for media files
  if (Capacitor.isNativePlatform()) {
    const eventSessionToken = localStorage.getItem(`event_session_${slug}`);
    if (eventSessionToken) {
      const separator = pathWithVersion.includes('?') ? '&' : '?';
      pathWithVersion = `${pathWithVersion}${separator}est=${encodeURIComponent(eventSessionToken)}`;
    }

    // Append Bearer token for authenticated media access (img tags can't send headers)
    const bearerToken = localStorage.getItem('mobile_bearer_token');
    if (bearerToken) {
      const separator = pathWithVersion.includes('?') ? '&' : '?';
      pathWithVersion = `${pathWithVersion}${separator}token=${encodeURIComponent(bearerToken)}`;
    }

    const domain = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`;
    return `${domain}${pathWithVersion}`;
  }

  return pathWithVersion;
};

/**
 * URL of a VIDEO's still-image poster (cover frame), served as a JPEG. Lets gallery/timeline
 * grids render a fast <img> for videos instead of mounting a <video> at the multi-MB MP4 just to
 * paint a frame. Returns 404 until a poster exists (generated by the nightly ffmpeg job and/or
 * captured at upload); callers fall back to the tiny blur_placeholder in that window. Mirrors
 * getPreviewUrl()'s native (Capacitor) token/`est` handling since <img> tags can't send headers.
 */
export const getVideoPosterUrl = (slug: string, photoId: string, cacheVersion?: number): string => {
  const relativePath = `/media/${slug}/poster/${photoId}.jpg`;
  let pathWithVersion = cacheVersion !== undefined ? `${relativePath}?v=${cacheVersion}` : relativePath;

  if (Capacitor.isNativePlatform()) {
    const eventSessionToken = localStorage.getItem(`event_session_${slug}`);
    if (eventSessionToken) {
      const separator = pathWithVersion.includes('?') ? '&' : '?';
      pathWithVersion = `${pathWithVersion}${separator}est=${encodeURIComponent(eventSessionToken)}`;
    }
    const bearerToken = localStorage.getItem('mobile_bearer_token');
    if (bearerToken) {
      const separator = pathWithVersion.includes('?') ? '&' : '?';
      pathWithVersion = `${pathWithVersion}${separator}token=${encodeURIComponent(bearerToken)}`;
    }
    const domain = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`;
    return `${domain}${pathWithVersion}`;
  }

  return pathWithVersion;
};

/**
 * Stores a client-captured poster JPEG for a freshly-uploaded video, so it has a cover image
 * immediately instead of waiting for the nightly job. Best-effort — callers ignore failures.
 */
export const uploadVideoPoster = async (slug: string, photoId: string, poster: Blob): Promise<void> => {
  await api.put(
    `/admin/events/${slug}/uploads/${photoId}/poster`,
    poster,
    { headers: { ...getAdminHeaders(), 'Content-Type': 'image/jpeg' }, timeout: START_UPLOAD_TIMEOUT_MS }
  );
};

/**
 * Appends the event session token (?est=) and/or mobile bearer token
 * (?token=) as query params, and resolves to an absolute URL. Used
 * exclusively for Cast (Chromecast) media URLs: the receiver runs in its own
 * browser context on the TV with no session cookie, so it can't rely on the
 * `ev_${slug}` cookie normal browser image requests use — see
 * requireMediaAccess/hasEventSessionAccess in the worker for the matching
 * server-side fallback.
 */
const toCastMediaUrl = (relativePath: string, slug: string): string => {
  let url = relativePath;

  const eventSessionToken = localStorage.getItem(`event_session_${slug}`);
  if (eventSessionToken) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}est=${encodeURIComponent(eventSessionToken)}`;
  }

  const bearerToken = localStorage.getItem('mobile_bearer_token');
  if (bearerToken) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}token=${encodeURIComponent(bearerToken)}`;
  }

  const domain = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`;
  return `${domain}${url}`;
};

export const getCastPreviewUrl = (slug: string, photoId: string, fileType?: string, cacheVersion?: number): string => {
  const isVideo = fileType === 'video/mp4';
  const extension = isVideo ? 'mp4' : 'jpg';
  const relativePath = `/media/${slug}/preview/${photoId}.${extension}`;
  const pathWithVersion = cacheVersion !== undefined ? `${relativePath}?v=${cacheVersion}` : relativePath;
  return toCastMediaUrl(pathWithVersion, slug);
};

export const getCastOriginalUrl = (slug: string, photoId: string, fileType?: string, cacheVersion?: number): string => {
  const isVideo = fileType === 'video/mp4';
  const isRaw = !!fileType && fileType.startsWith('raw/');
  const extension = isVideo ? 'mp4' : isRaw ? fileType!.slice('raw/'.length) : 'jpg';
  const relativePath = `/media/${slug}/original/${photoId}.${extension}`;
  const pathWithVersion = cacheVersion !== undefined ? `${relativePath}?v=${cacheVersion}` : relativePath;
  return toCastMediaUrl(pathWithVersion, slug);
};

/**
 * Fetches a portable event-scoped session token for the *currently*
 * authenticated caller — via whatever mechanism actually granted access
 * (Cloudflare Access cookie, collaborator/admin identity, event password, or
 * public visibility) — and caches it under the same localStorage key
 * (`event_session_${slug}`) that getCastOriginalUrl/getCastPreviewUrl above
 * already read from. Must be called before starting a Cast session for
 * events that aren't password-protected (e.g. private/collaborators-only
 * events reached via Cloudflare Access login), since otherwise those
 * helpers have no token to attach and the receiver's media requests 401.
 * Silently no-ops on failure — Cast media just fails to load, same as
 * before this endpoint existed.
 */
export const ensureCastToken = async (slug: string): Promise<void> => {
  try {
    if (Capacitor.isNativePlatform()) {
      const domain = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`;
      const headers: Record<string, string> = {};
      const bearerToken = await MobileAuthService.getToken();
      if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
      const eventSessionToken = await MobileAuthService.getEventSessionToken(slug);
      if (eventSessionToken) headers['X-Event-Session'] = eventSessionToken;

      const response = await fetch(`${domain}/media/${encodeURIComponent(slug)}/cast-token`, { headers });
      if (!response.ok) return;
      const data = await response.json() as { token?: string };
      if (data.token) {
        await MobileAuthService.setEventSessionToken(slug, data.token);
      }
      return;
    }

    const response = await fetch(`/media/${encodeURIComponent(slug)}/cast-token`, { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json() as { token?: string };
    if (data.token) {
      localStorage.setItem(`event_session_${slug}`, data.token);
    }
  } catch {
    // Ignore — Cast media will simply fail to load if this doesn't succeed.
  }
};

const DEFAULT_DOWNLOAD_PATH = '/storage/emulated/0/Download';

const getMimeTypeFromFilename = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'image/jpeg';
};

const toExternalStorageRelativePath = (basePath: string, filename: string): string => {
  const normalized = basePath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const withoutPrefix = normalized.replace(/^\/storage\/emulated\/0\/?/, '');
  const relativeBase = withoutPrefix.replace(/^\/+/, '');
  return relativeBase ? `${relativeBase}/${filename}` : filename;
};

const saveNativeBase64File = async (base64: string, filename: string, mimeType: string): Promise<string> => {
  const selectedPath = localStorage.getItem('download_path') || DEFAULT_DOWNLOAD_PATH;
  console.log('[Download] Selected save path:', selectedPath);

  try {
    if (selectedPath.startsWith('content://')) {
      // SAF tree URI selected via folder picker.
      const result = await SafDirectory.writeFile({
        treeUri: selectedPath,
        filename,
        data: base64,
        mimeType,
      });
      return result.uri;
    }

    const relativePath = toExternalStorageRelativePath(selectedPath, filename);
    const result = await Filesystem.writeFile({
      path: relativePath,
      data: base64,
      directory: Directory.ExternalStorage,
      recursive: true,
    });
    return result.uri;
  } catch (error) {
    console.warn('[Download] Selected folder write failed, falling back to Documents', error);
    const fallbackResult = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });
    return fallbackResult.uri;
  }
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
      
      const mimeType = getMimeTypeFromFilename(filename);
      const savedUri = await saveNativeBase64File(base64, filename, mimeType);
      console.log('[Download] File saved:', savedUri);
      alert(`Photo saved: ${filename}`);
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

      await saveNativeBase64File(base64, filename, 'image/jpeg');
      alert(`Instagram photo saved: ${filename}`);
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

      const savedUri = await saveNativeBase64File(base64, filename, 'application/zip');
      console.log('[Download ZIP] File saved:', savedUri);
      alert(`ZIP file saved: ${filename}`);
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
  await api.put(`/admin/photos/${photoId}/featured`, { isFeatured }, {
    headers: getAdminHeaders(),
  });
};

export const setEventLocation = async (slug: string, latitude: number, longitude: number): Promise<{ updated_count: number }> => {
  const response = await api.put<{ updated_count: number }>(
    `/admin/events/${slug}/location`,
    { latitude, longitude },
    { headers: getAdminHeaders() }
  );
  return response.data;
};

/** Set/override the GPS location for a specific set of photos (admin only). */
export const bulkUpdatePhotoLocation = async (
  photoIds: string[],
  latitude: number,
  longitude: number
): Promise<{ updatedCount: number; totalRequested: number }> => {
  // Chunked — see bulkDeletePhotos()'s doc comment above (same 500-per-call worker cap).
  const BULK_CHUNK_SIZE = 500;
  let updatedCount = 0;
  for (let i = 0; i < photoIds.length; i += BULK_CHUNK_SIZE) {
    const chunk = photoIds.slice(i, i + BULK_CHUNK_SIZE);
    const response = await api.patch<{ updatedCount: number; totalRequested: number }>(
      '/admin/photos/bulk-location',
      { photoIds: chunk, latitude, longitude },
      { headers: getAdminHeaders() }
    );
    updatedCount += response.data.updatedCount;
  }
  return { updatedCount, totalRequested: photoIds.length };
};

/** Adds (never replaces/removes) one or more people as manually-tagged across a batch of
 *  selected photos at once — the EventGallery multi-select "Tag people" action. Existing tags
 *  (on these or any other photo) are left untouched — see addManualPhotoPersonTags()'s doc
 *  comment in apps/worker/src/faceClustering.ts. */
export const bulkTagPeopleOnPhotos = async (
  photoIds: string[],
  personIds: number[]
): Promise<{ taggedPhotoCount: number }> => {
  // Chunked (photos, not people — personIds is already capped at 50 per call server-side and is
  // never large) — see bulkDeletePhotos()'s doc comment above (same 500-per-call worker cap).
  const BULK_CHUNK_SIZE = 500;
  let taggedPhotoCount = 0;
  for (let i = 0; i < photoIds.length; i += BULK_CHUNK_SIZE) {
    const chunk = photoIds.slice(i, i + BULK_CHUNK_SIZE);
    const response = await api.post<{ success: boolean; taggedPhotoCount: number }>(
      '/admin/photos/bulk-tag-people',
      { photoIds: chunk, personIds },
      { headers: getAdminHeaders() }
    );
    taggedPhotoCount += response.data.taggedPhotoCount;
  }
  return { taggedPhotoCount };
};

/** Removes EVERY person (manual tags AND auto-detected faces) from every selected photo at once
 *  — the "Person: none" bulk action for a multi-select, the inverse of bulkTagPeopleOnPhotos()
 *  above. See removeAllPeopleFromPhotos()'s doc comment in apps/worker/src/faceClustering.ts. */
export const bulkUntagPeopleOnPhotos = async (photoIds: string[]): Promise<{ clearedCount: number }> => {
  const BULK_CHUNK_SIZE = 500;
  let clearedCount = 0;
  for (let i = 0; i < photoIds.length; i += BULK_CHUNK_SIZE) {
    const chunk = photoIds.slice(i, i + BULK_CHUNK_SIZE);
    const response = await api.post<{ success: boolean; photosCleared: number }>(
      '/admin/photos/bulk-untag-people',
      { photoIds: chunk },
      { headers: getAdminHeaders() }
    );
    clearedCount += response.data.photosCleared;
  }
  return { clearedCount };
};

export const geocodeEventPhotos = async (slug: string): Promise<{ updated: number; total: number }> => {
  const response = await api.post<{ updated: number; total: number }>(
    `/admin/events/${slug}/geocode-photos`,
    undefined,
    { headers: getAdminHeaders() }
  );
  return response.data;
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

/**
 * Domains the activity feed can be filtered by. The server owns the mapping
 * from domain to action prefixes (DOMAIN_PREFIXES in
 * apps/worker/src/routes/admin/analytics.ts), so new actions in an existing
 * domain need no change here.
 */
export const ACTIVITY_DOMAINS = ['photos', 'events', 'people', 'sharing', 'tags'] as const;
export type ActivityDomain = (typeof ACTIVITY_DOMAINS)[number];

export type ActivityAction =
  | 'photo_upload'
  | 'photo_favorite'
  | 'photo_trash'
  | 'photo_restore'
  | 'photo_delete_permanent'
  | 'photo_bulk_delete'
  | 'photo_bulk_copy'
  | 'photo_replace'
  | 'photo_archive'
  | 'photo_featured'
  | 'photo_location_edit'
  | 'event_create'
  | 'event_update'
  | 'event_delete'
  | 'event_tags_update'
  | 'event_location_update'
  | 'tag_create'
  | 'tag_update'
  | 'tag_delete'
  | 'person_update'
  | 'person_create'
  | 'person_merge'
  | 'person_delete'
  | 'person_tag_add'
  | 'person_tag_remove'
  // Sourced from collaboration_history, namespaced server-side.
  | 'collab_invite'
  | 'collab_accept'
  | 'collab_decline'
  | 'collab_remove'
  | 'collab_upload';

export interface ActivityEntry {
  /** Which table the row came from. `id` is only unique WITHIN a source, so
   *  React keys must combine the two. */
  source: 'activity' | 'collab';
  id: number;
  event_id: number | null;
  event_name: string | null;
  event_slug: string | null;
  actor_email: string;
  /** Widened over time; the UI keeps an unknown-action fallback rather than
   *  assuming this list is exhaustive. */
  action: ActivityAction | (string & {});
  target_type: string | null;
  target_id: string | null;
  /** Only set for collaboration entries (who was invited/removed). */
  target_user_email: string | null;
  metadata: string | null;
  created_at: string;
}

export interface ActivityFeedOptions {
  limit?: number;
  /** ISO timestamp from a previous response's `nextCursor`. */
  before?: string | null;
  domain?: ActivityDomain | null;
  eventSlug?: string | null;
  actor?: string | null;
}

/** Site-wide activity feed (polling-based, admin only). Unions the photo/event
 *  action log with collaboration history — see the endpoint's doc comment. */
export const getActivityFeed = async (
  options: ActivityFeedOptions = {}
): Promise<{ activity: ActivityEntry[]; nextCursor: string | null }> => {
  const params: Record<string, string> = { limit: String(options.limit ?? 50) };
  if (options.before) params.before = options.before;
  if (options.domain) params.domain = options.domain;
  if (options.eventSlug) params.eventSlug = options.eventSlug;
  if (options.actor) params.actor = options.actor;

  const response = await api.get<{ activity: ActivityEntry[]; nextCursor: string | null }>(
    '/admin/stats/activity',
    { params, headers: getAdminHeaders() }
  );
  return response.data;
};

/** Distinct actors across both feeds, for the activity page's filter dropdown. */
export const getActivityActors = async (): Promise<string[]> => {
  const response = await api.get<{ actors: string[] }>('/admin/stats/activity/actors', {
    headers: getAdminHeaders(),
  });
  return response.data.actors;
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

/** Restore a photo out of Trash. */
export const restorePhoto = async (photoId: string): Promise<void> => {
  await api.put(`/admin/photos/${photoId}/restore`, undefined, {
    headers: getAdminHeaders(),
  });
};

/** Permanently delete a single (already-trashed) photo right away. */
export const permanentlyDeletePhoto = async (photoId: string): Promise<void> => {
  await api.delete(`/admin/photos/${photoId}/permanent`, {
    headers: getAdminHeaders(),
  });
};

/** Toggle a photo's archived status (hidden from Timeline, still in its event gallery). */
export const setPhotoArchived = async (photoId: string, isArchived: boolean): Promise<void> => {
  await api.put(`/admin/photos/${photoId}/archive`, { isArchived }, {
    headers: getAdminHeaders(),
  });
};

export interface TrashPhoto extends Photo {
  event_slug: string;
  event_name: string;
}

/** List every currently-trashed photo (admin only). */
export const getTrash = async (): Promise<{ photos: TrashPhoto[]; retentionDays: number }> => {
  const response = await api.get<{ photos: TrashPhoto[]; retentionDays: number }>('/admin/photos/trash', {
    headers: getAdminHeaders(),
  });
  return response.data;
};

/** Permanently delete every currently-trashed photo right away (admin only). */
export const emptyTrash = async (): Promise<{ deletedCount: number }> => {
  const response = await api.post<{ deletedCount: number }>('/admin/photos/trash/empty', undefined, {
    headers: getAdminHeaders(),
  });
  return response.data;
};

export interface DuplicatePhoto extends Photo {
  event_slug: string;
  event_name: string;
}

export interface DuplicateGroup {
  fileHash: string;
  photos: DuplicatePhoto[];
}

/** Groups of exact-content duplicate photos (by file_hash), across all events (admin only). */
export const getDuplicatePhotos = async (): Promise<DuplicateGroup[]> => {
  const response = await api.get<{ groups: DuplicateGroup[] }>('/admin/photos/duplicates', {
    headers: getAdminHeaders(),
  });
  return response.data.groups;
};

/** Copies people already identified on any duplicate photo (same file_hash, any event) to every
 *  other copy missing them — see syncPeopleAcrossDuplicates()'s doc comment in
 *  apps/worker/src/faceClustering.ts. Manual-tag-only, safe to re-run repeatedly. */
export const syncPeopleAcrossDuplicates = async (): Promise<{ groupsSynced: number; tagsAdded: number }> => {
  const response = await api.post<{ success: boolean; groupsSynced: number; tagsAdded: number }>(
    '/admin/photos/duplicates/sync-people',
    {},
    { headers: getAdminHeaders() }
  );
  return { groupsSynced: response.data.groupsSynced, tagsAdded: response.data.tagsAdded };
};

export interface MissingHashPhoto {
  id: string;
  file_type: string;
  cache_version: number | null;
  event_slug: string;
}

/** ONE PAGE of photos (images/RAW only) with no file_hash yet — see GET
 *  /admin/photos/missing-file-hash's doc comment in routes/admin/photos.ts for why so many
 *  photos ended up in this state (a background-sync upload bug, fixed 2026-08-06, meant most
 *  photos uploaded via the Android app never got a hash at all). Used by the one-time
 *  "Backfill file hashes" admin action on the Duplicates page. */
export const getPhotosMissingFileHash = async (
  cursor: string | null = null,
  limit = 50
): Promise<{ photos: MissingHashPhoto[]; nextCursor: string | null }> => {
  const response = await api.get<{ photos: MissingHashPhoto[]; nextCursor: string | null }>(
    '/admin/photos/missing-file-hash',
    { params: { ...(cursor ? { cursor } : undefined), limit }, headers: getAdminHeaders() }
  );
  return response.data;
};

/** Sets a single photo's file_hash (computed client-side by the caller) — never overwrites an
 *  already-set hash. Returns `updated: false` if the photo already had one (a no-op, not an
 *  error) so the backfill loop can just move on. */
export const setPhotoFileHash = async (photoId: string, fileHash: string): Promise<{ updated: boolean }> => {
  const response = await api.patch<{ success: boolean; updated: boolean }>(
    `/admin/photos/${photoId}/file-hash`,
    { fileHash },
    { headers: getAdminHeaders() }
  );
  return { updated: response.data.updated };
};

export const bulkDeletePhotos = async (photoIds: string[]): Promise<{ deletedCount: number; totalRequested: number }> => {
  // Chunked to stay under the worker's own per-call cap (BULK_DELETE_MAX_PHOTOS = 500 in
  // admin/photos.ts) — callers like a duplicate-cleanup banner can easily gather more than 500
  // ids at once (e.g. "855 duplicate photos in 110 sets"), which previously failed outright with
  // "Cannot delete more than 500 photos at once" instead of silently succeeding in batches.
  const BULK_CHUNK_SIZE = 500;
  let deletedCount = 0;
  for (let i = 0; i < photoIds.length; i += BULK_CHUNK_SIZE) {
    const chunk = photoIds.slice(i, i + BULK_CHUNK_SIZE);
    const response = await api.post<{ deletedCount: number; totalRequested: number; errors?: any[] }>(
      '/admin/photos/bulk-delete',
      { photoIds: chunk },
      { headers: getAdminHeaders() }
    );
    deletedCount += response.data.deletedCount;
  }
  return { deletedCount, totalRequested: photoIds.length };
};

export const bulkCopyPhotos = async (photoIds: string[], targetEventSlug: string): Promise<{ copiedCount: number; totalRequested: number }> => {
  // Chunked — see bulkDeletePhotos()'s doc comment above (same 500-per-call worker cap).
  const BULK_CHUNK_SIZE = 500;
  let copiedCount = 0;
  for (let i = 0; i < photoIds.length; i += BULK_CHUNK_SIZE) {
    const chunk = photoIds.slice(i, i + BULK_CHUNK_SIZE);
    const response = await api.post<{ copiedCount: number; totalRequested: number; errors?: any[] }>(
      '/admin/photos/bulk-copy',
      { photoIds: chunk, targetEventSlug },
      { headers: getAdminHeaders() }
    );
    copiedCount += response.data.copiedCount;
  }
  return { copiedCount, totalRequested: photoIds.length };
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

/** The signed-in user as the SERVER sees them, or null if not authenticated.
 *
 *  Goes through the shared `api` instance, so on native the bearer-token
 *  interceptor authenticates it — unlike AuthContext's web path, which uses a
 *  raw cookie-authenticated fetch(). Used on native to reconcile the locally
 *  cached user (written once at OAuth callback time) against the database,
 *  which is the source of truth for `name` and `isAdmin`. */
export const getUserProfile = async () => {
  const response = await api.get<{ user: User | null }>('/user/profile');
  return response.data.user;
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
  // Send each image as a raw application/octet-stream body rather than multipart
  // FormData. The native Android WebView does not reliably serialize FormData
  // with Blobs, which silently broke photo editing on mobile; raw binary bodies
  // are exactly what the chunked upload flow uses and are proven to work natively.
  const fileType = originalBlob.type || 'image/jpeg';
  const putRaw = (target: 'original' | 'preview', body: Blob) =>
    api.put(`/admin/photos/${photoId}/replace?target=${target}`, body, {
      headers: {
        ...getAdminHeaders(),
        'Content-Type': 'application/octet-stream',
        'X-File-Type': fileType,
      },
    });

  // Write the preview first, then the original last so the original write (which
  // also busts the Instagram export) completes after both blobs are stored.
  await putRaw('preview', previewBlob);
  await putRaw('original', originalBlob);
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
