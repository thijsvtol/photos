import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, MapPin, RefreshCw, Globe, Upload, Eye, Camera, Heart, AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import { ulid } from 'ulid';
import ExifReader from 'exifreader';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import Navbar from '../components/Navbar';
import FolderSyncManager from '../components/FolderSyncManager';
import { getEvent, startUpload, uploadPart, completeUpload, regenerateThumbnails, setEventLocation, getEventStats, getPreviewUrl, geocodeEventPhotos } from '../api';
import { addToQueue, updateQueueItem, getQueueItems, getPendingUploads } from '../uploadQueue';
import { createPreview } from '../imageUtils';
import type { Event, UploadQueueItem, EventStats } from '../types';

// Fix Leaflet marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

const AdminEventUpload: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);
  const [isAnalyticsExpanded, setIsAnalyticsExpanded] = useState(() => {
    // Open by default on desktop (>= 768px), closed on mobile
    return typeof window !== 'undefined' && window.innerWidth >= 768;
  });
  const [queueItemsToShow, setQueueItemsToShow] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (slug) {
      setIsLoading(true);
      Promise.all([
        loadEvent(),
        loadStats(),
        loadQueue(),
      ]).finally(() => {
        setIsLoading(false);
      });
      // Resume any pending uploads
      resumePendingUploads();
    }
  }, [slug]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const loadEvent = async () => {
    try {
      const eventData = await getEvent(slug!);
      setEvent(eventData);
    } catch (err) {
      setError('Failed to load event');
      console.error(err);
    }
  };

  const loadStats = async () => {
    try {
      const statsData = await getEventStats(slug!);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const loadQueue = async () => {
    try {
      const items = await getQueueItems(slug);
      setQueueItems(items);
    } catch (err) {
      console.error('Failed to load queue:', err);
    }
  };

  const resumePendingUploads = async () => {
    try {
      const pending = await getPendingUploads(slug);
      for (const item of pending) {
        if (item.status === 'pending') {
          processUpload(item);
        }
      }
    } catch (err) {
      console.error('Failed to resume uploads:', err);
    }
  };

  const parseExifDate = (exifDate: string): string | undefined => {
    try {
      // EXIF date format: "YYYY:MM:DD HH:MM:SS"
      // Convert to ISO format: "YYYY-MM-DDTHH:MM:SS"
      const cleaned = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const date = new Date(cleaned);
      
      // Validate the date
      if (isNaN(date.getTime())) {
        return undefined;
      }
      
      return date.toISOString();
    } catch {
      return undefined;
    }
  };

  const extractExifData = async (file: File): Promise<{ 
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
  }> => {
    try {
      const buffer = await file.arrayBuffer();
      const tags = ExifReader.load(buffer);
      
      const captureTime = tags.DateTimeOriginal?.description;
      const width = tags.PixelXDimension?.value || tags['Image Width']?.value;
      const height = tags.PixelYDimension?.value || tags['Image Height']?.value;
      const iso = tags.ISOSpeedRatings?.value;
      const aperture = tags.FNumber?.description;
      const shutterSpeed = tags.ExposureTime?.description;
      const focalLength = tags.FocalLength?.description;
      const cameraMake = tags.Make?.description;
      const cameraModel = tags.Model?.description;
      const lensModel = tags.LensModel?.description;
      
      // Extract GPS coordinates
      let latitude: number | undefined;
      let longitude: number | undefined;
      if (tags.GPSLatitude && tags.GPSLongitude) {
        latitude = parseFloat(tags.GPSLatitude.description);
        longitude = parseFloat(tags.GPSLongitude.description);
      }
      
      // Generate tiny blur placeholder (16x16)
      let blurPlaceholder: string | undefined;
      try {
        const img = new Image();
        const url = URL.createObjectURL(file);
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
        
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 16, 16);
          blurPlaceholder = canvas.toDataURL('image/jpeg', 0.3);
        }
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Failed to generate blur placeholder:', err);
      }
      
      return {
        captureTime: captureTime ? parseExifDate(captureTime) : undefined,
        width: typeof width === 'number' ? width : undefined,
        height: typeof height === 'number' ? height : undefined,
        iso: typeof iso === 'number' ? iso : undefined,
        aperture: aperture || undefined,
        shutterSpeed: shutterSpeed || undefined,
        focalLength: focalLength || undefined,
        cameraMake: cameraMake || undefined,
        cameraModel: cameraModel || undefined,
        lensModel: lensModel || undefined,
        latitude: latitude || undefined,
        longitude: longitude || undefined,
        blurPlaceholder: blurPlaceholder || undefined,
      };
    } catch (err) {
      console.error('Failed to extract EXIF:', err);
      return {};
    }
  };

  const handleFiles = async (files: FileList) => {
    const supportedFiles = Array.from(files).filter(f => 
      f.type === 'image/jpeg' || f.type === 'video/mp4'
    );
    
    for (const file of supportedFiles) {
      const id = ulid();
      const photoId = ulid();
      const isVideo = file.type === 'video/mp4';
      
      // Extract EXIF data only for images
      const exif = isVideo ? {} : await extractExifData(file);
      
      const item: UploadQueueItem = {
        id,
        eventSlug: slug!,
        file,
        fileType: file.type,
        status: 'pending',
        progress: 0,
        photoId,
        ...exif,
      };
      
      await addToQueue(item);
      setQueueItems(prev => [...prev, item]);
      
      // Start upload
      processUpload(item);
    }
  };

  const processUpload = async (item: UploadQueueItem) => {
    try {
      await updateQueueItem(item.id, { status: 'uploading' });
      setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'uploading' } : i));
      
      const isVideo = item.fileType === 'video/mp4';
      
      // Create preview version client-side (only for images)
      let previewBlob: Blob | null = null;
      if (!isVideo) {
        previewBlob = await createPreview(item.file);
      }
      
      // Start multipart upload for original
      const { uploadId } = await startUpload(
        item.eventSlug,
        item.photoId!,
        item.file.name,
        item.captureTime,
        item.width,
        item.height,
        item.iso,
        item.aperture,
        item.shutterSpeed,
        item.focalLength,
        item.cameraMake,
        item.cameraModel,
        item.lensModel,
        item.latitude,
        item.longitude,
        item.blurPlaceholder,
        false,
        item.fileType
      );
      
      await updateQueueItem(item.id, { uploadId });
      
      // Upload original parts (progress: 0-80% for images, 0-100% for videos)
      const parts: Array<{ partNumber: number; etag: string }> = [];
      const totalParts = Math.ceil(item.file.size / CHUNK_SIZE);
      const originalProgressMax = isVideo ? 100 : 80;
      
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, item.file.size);
        const chunk = item.file.slice(start, end);
        
        // Upload part directly to worker
        const { etag } = await uploadPart(
          item.eventSlug,
          item.photoId!,
          uploadId,
          partNumber,
          chunk,
          false,
          item.fileType
        );
        
        parts.push({ partNumber, etag });
        
        // Update progress
        const progress = Math.round((partNumber / totalParts) * originalProgressMax);
        await updateQueueItem(item.id, { progress, parts });
        setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, progress, parts } : i));
      }
      
      // Complete original upload
      await completeUpload(item.eventSlug, item.photoId!, uploadId, parts);
      
      // For videos, we're done. For images, upload preview
      if (isVideo) {
        await updateQueueItem(item.id, { status: 'completed', progress: 100 });
        setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'completed', progress: 100 } : i));
      } else {
        // Update progress to 85%
        await updateQueueItem(item.id, { progress: 85 });
        setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, progress: 85 } : i));
        
        // Upload preview version (85-100% of progress)
        await uploadPreview(item.eventSlug, item.photoId!, previewBlob!);
        
        await updateQueueItem(item.id, { status: 'completed', progress: 100 });
        setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'completed', progress: 100 } : i));
      }
    } catch (err) {
      console.error('Upload failed:', err);
      await updateQueueItem(item.id, { status: 'failed', error: String(err) });
      setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'failed', error: String(err) } : i));
    }
  };

  const uploadPreview = async (eventSlug: string, photoId: string, previewBlob: Blob): Promise<string> => {
    // Start multipart upload for preview
    const { uploadId } = await startUpload(
      eventSlug,
      photoId,
      `${photoId}_preview.jpg`,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true // isPreview flag
    );
    
    // Upload preview parts
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.ceil(previewBlob.size / CHUNK_SIZE);
    
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, previewBlob.size);
      const chunk = previewBlob.slice(start, end);
      
      const { etag } = await uploadPart(
        eventSlug,
        photoId,
        uploadId,
        partNumber,
        chunk,
        true // isPreview flag
      );
      
      parts.push({ partNumber, etag });
    }
    
    // Complete preview upload
    await completeUpload(eventSlug, photoId, uploadId, parts, true);
    
    return uploadId;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  }, [slug]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'uploading': return 'bg-blue-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const handleRegenerateThumbnails = async () => {
    if (!slug) return;
    
    setIsRegenerating(true);
    setError(null);
    
    try {
      const result = await regenerateThumbnails(slug);
      alert(`Regenerating thumbnails for ${result.count} photos. This may take a few moments.`);
    } catch (err) {
      setError('Failed to regenerate thumbnails');
      console.error(err);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleGeocodePhotos = async () => {
    if (!slug || !confirm('This will fetch city names for all photos with GPS coordinates. This may take a while. Continue?')) {
      return;
    }
    try {
      setIsGeocoding(true);
      const result = await geocodeEventPhotos(slug);
      if (result.updated === 0) {
        alert('No photos needed geocoding. All photos with GPS already have city names.');
      } else {
        alert(`Successfully geocoded ${result.updated} of ${result.total} photos`);
        loadEvent();
      }
    } catch (err) {
      alert('Failed to geocode photos');
      console.error(err);
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleSetEventLocation = async () => {
    if (!slug || !selectedLocation) return;
    
    try {
      const [lat, lng] = selectedLocation;
      const result = await setEventLocation(slug, lat, lng);
      alert(`Successfully set GPS location for ${result.updated_count} photos without GPS data.`);
      setShowLocationPicker(false);
      setSelectedLocation(null);
    } catch (err) {
      setError('Failed to set event location');
      console.error(err);
    }
  };

  // Map click handler component
  const LocationMarker: React.FC = () => {
    useMapEvents({
      click(e) {
        setSelectedLocation([e.latlng.lat, e.latlng.lng]);
      },
    });
    
    return selectedLocation ? <Marker position={selectedLocation} /> : null;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <Link to="/admin" className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mb-4 inline-flex items-center gap-1 text-sm sm:text-base transition">
            ← Back to Admin
          </Link>
          <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 mt-4">
            <div className="flex-1">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white">{event?.name || 'Loading...'}</h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2 text-sm sm:text-base">Upload and manage photos for this event</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 lg:flex-shrink-0">
              <button
                onClick={() => setShowLocationPicker(true)}
                className="px-3 py-2 sm:px-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm sm:text-base flex items-center justify-center gap-2 shadow-sm hover:shadow"
                aria-label="Set GPS Location"
              >
                <MapPin className="w-4 h-4" />
                <span>Set GPS</span>
              </button>
              <button
                onClick={handleRegenerateThumbnails}
                disabled={isRegenerating}
                className="px-3 py-2 sm:px-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed text-sm sm:text-base flex items-center justify-center gap-2 shadow-sm hover:shadow"
                aria-label="Regenerate Thumbnails"
              >
                {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span className="hidden sm:inline">{isRegenerating ? 'Regenerating...' : 'Regenerate'}</span>
                <span className="sm:hidden">{isRegenerating ? 'Wait...' : 'Regen thumbnails'}</span>
              </button>
              <button
                onClick={handleGeocodePhotos}
                disabled={isGeocoding}
                className="px-3 py-2 sm:px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed text-sm sm:text-base flex items-center justify-center gap-2 shadow-sm hover:shadow"
                title="Fetch city names for photos with GPS coordinates"
                aria-label="Geocode Cities"
              >
                {isGeocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                <span className="hidden sm:inline">{isGeocoding ? 'Geocoding...' : 'Geocode'}</span>
                <span className="sm:hidden">{isGeocoding ? 'Wait...' : 'Geocode'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg mb-4 flex items-start gap-3 animate-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        
        {successMessage && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg mb-4 flex items-start gap-3 animate-in slide-in-from-top-2">
            <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
          </div>
        ) : (
        <>
        {/* Event Analytics */}
        {stats && (
          <div className="mb-6 sm:mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow p-4 sm:p-6">
              <button
                onClick={() => setIsAnalyticsExpanded(!isAnalyticsExpanded)}
                className="flex items-center justify-between w-full text-left group"
                aria-expanded={isAnalyticsExpanded}
              >
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Camera className="w-5 h-5" />
                  <span>Event Analytics</span>
                </h2>
                <div className="p-1 rounded-lg group-hover:bg-gray-100 dark:group-hover:bg-gray-700 transition">
                  {isAnalyticsExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  )}
                </div>
              </button>
              
              {isAnalyticsExpanded && (
                <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-4 sm:mt-6">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 sm:p-4 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition">
                  <div className="text-xl sm:text-2xl font-bold text-blue-900 dark:text-blue-300">{stats.photoCount}</div>
                  <div className="text-xs sm:text-sm text-blue-700 dark:text-blue-400 mt-1">Total Photos</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 sm:p-4 hover:bg-green-100 dark:hover:bg-green-900/30 transition">
                  <div className="text-xl sm:text-2xl font-bold text-green-900 dark:text-green-300">{stats.photosWithGPS}</div>
                  <div className="text-xs sm:text-sm text-green-700 dark:text-green-400 mt-1">With GPS Data</div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 sm:p-4 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition">
                  <div className="text-xl sm:text-2xl font-bold text-yellow-900 dark:text-yellow-300">{stats.featuredCount}</div>
                  <div className="text-xs sm:text-sm text-yellow-700 dark:text-yellow-400 mt-1">Featured Photos</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 sm:p-4 hover:bg-red-100 dark:hover:bg-red-900/30 transition">
                  <div className="text-xl sm:text-2xl font-bold text-red-900 dark:text-red-300">{stats.totalFavorites}</div>
                  <div className="text-xs sm:text-sm text-red-700 dark:text-red-400 mt-1">Total Favorites</div>
                </div>
              </div>

              {stats.topFavorites && stats.topFavorites.length > 0 && (
                <div className="mb-4 sm:mb-6">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Heart className="w-5 h-5 text-red-500" />
                    <span>Top Favorited Photos</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
                    {stats.topFavorites.map((photo) => (
                      <div key={photo.id} className="relative group overflow-hidden rounded-lg">
                        <img
                          src={getPreviewUrl(slug!, photo.id)}
                          alt={photo.original_filename}
                          className="w-full aspect-square object-cover rounded-lg shadow-sm group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent text-white px-2 py-2 text-xs flex items-center gap-1">
                          <Heart className="w-3 h-3 fill-red-500 text-red-500" />
                          <span>{photo.favorites_count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.cameraModels && stats.cameraModels.length > 0 && (
                <div className="mb-4 sm:mb-6">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Camera className="w-5 h-5" />
                    <span>Cameras Used</span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {stats.cameraModels.map((camera, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs sm:text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                      >
                        {camera.camera_model} ({camera.count})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 sm:mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <Link
                  to={`/events/${slug}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm hover:shadow"
                >
                  <Eye className="w-4 h-4" />
                  <span>View Gallery</span>
                </Link>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-2">
                  View the gallery as admin to manage photos (delete, mark as featured)
                </p>
              </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-4 border-dashed rounded-xl p-8 sm:p-12 mb-6 sm:mb-8 text-center transition-all duration-200 ${
            isDragging 
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.02]' 
              : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-600'
          }`}
        >
          <div className="flex flex-col items-center">
            <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mb-4 transition ${
              isDragging ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-700'
            }`}>
              <Upload className={`w-8 h-8 sm:w-10 sm:h-10 ${
                isDragging ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
              }`} />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {isDragging ? 'Drop files here' : 'Drag & Drop Photos Here'}
            </h3>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mb-4">or</p>
            <label className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition cursor-pointer inline-flex items-center gap-2 shadow-sm hover:shadow">
              <Upload className="w-4 h-4" />
              <span>Browse Files</span>
              <input
                type="file"
                multiple
                accept="image/jpeg,video/mp4"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-4">Supports JPEG images and MP4 videos</p>
          </div>
        </div>

        {/* Folder Sync Manager */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow p-4 sm:p-6 mb-6 sm:mb-8">
          <FolderSyncManager eventSlug={slug!} />
        </div>

        {/* Upload Queue */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow p-4 sm:p-6">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5" />
            <span>Upload Queue</span>
            {queueItems.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full">
                {queueItems.length}
              </span>
            )}
          </h2>
          
          {queueItems.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-gray-600 dark:text-gray-400">No uploads in queue</p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">Files you upload will appear here</p>
            </div>
          ) : (
            <>
            <div className="space-y-3 sm:space-y-4">
              {queueItems.slice(0, queueItemsToShow).map((item) => (
                <div key={item.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 hover:border-gray-300 dark:hover:border-gray-600 transition bg-gray-50 dark:bg-gray-900/50">
                  <div className="flex justify-between items-start mb-2 gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate text-sm sm:text-base">{item.file.name}</p>
                      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                        {(item.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <span className={`px-2 sm:px-3 py-1 rounded-full text-white text-xs font-medium ${getStatusColor(item.status)} flex-shrink-0`}>
                      {item.status}
                    </span>
                  </div>
                  
                  {item.status === 'uploading' && (
                    <div className="space-y-1">
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${item.progress}%` }}
                        ></div>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>{item.progress}%</span>
                      </p>
                    </div>
                  )}
                  
                  {item.status === 'failed' && (
                    <div className="flex items-start gap-2 text-xs sm:text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded p-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{item.error}</span>
                    </div>
                  )}
                  
                  {item.captureTime && (
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-2">
                      Captured: {new Date(item.captureTime).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {queueItems.length > queueItemsToShow && (
              <div className="mt-4 sm:mt-6 text-center">
                <button
                  onClick={() => setQueueItemsToShow(prev => prev + 10)}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm hover:shadow flex items-center gap-2 mx-auto text-sm sm:text-base"
                >
                  <ChevronDown className="w-4 h-4" />
                  <span>Load More ({queueItems.length - queueItemsToShow} remaining)</span>
                </button>
              </div>
            )}
            </>
          )}
        </div>
        </>
        )}
      </div>

      {/* GPS Location Picker Modal */}
      {showLocationPicker && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] h-[600px] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-start gap-4">
              <div className="flex-1">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  <span>Set GPS Location for Event</span>
                </h2>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Click on the map to select a location. This will update photos without GPS data.
                </p>
              </div>
              <button 
                onClick={() => setShowLocationPicker(false)} 
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 relative">
              <MapContainer
                center={selectedLocation || [51.505, -0.09]}
                zoom={13}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <LocationMarker />
              </MapContainer>
            </div>
            <div className="p-4 sm:p-6 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                {selectedLocation ? (
                  <>
                    <MapPin className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span>Selected: {selectedLocation[0].toFixed(6)}, {selectedLocation[1].toFixed(6)}</span>
                  </>
                ) : (
                  <span>Click on the map to select a location</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLocationPicker(false)}
                  className="flex-1 sm:flex-none px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm sm:text-base"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSetEventLocation}
                  disabled={!selectedLocation}
                  className="flex-1 sm:flex-none px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 text-sm sm:text-base"
                >
                  <MapPin className="w-4 h-4" />
                  <span>Set Location</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminEventUpload;
