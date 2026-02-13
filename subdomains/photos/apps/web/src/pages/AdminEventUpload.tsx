import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapPin, RefreshCw, Globe, Upload, AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import { ulid } from 'ulid';
import ExifReader from 'exifreader';
import L from 'leaflet';
import Navbar from '../components/Navbar';
import FolderSyncManager from '../components/FolderSyncManager';
import EventAnalytics from '../components/EventAnalytics';
import EventLocationPicker from '../components/EventLocationPicker';
import UploadQueueList from '../components/UploadQueueList';
import { getEvent, startUpload, uploadPart, completeUpload, regenerateThumbnails, setEventLocation, getEventStats, geocodeEventPhotos } from '../api';
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

  const handleSetEventLocation = async (lat: number, lng: number) => {
    if (!slug) return;
    
    try {
      const result = await setEventLocation(slug, lat, lng);
      alert(`Successfully set GPS location for ${result.updated_count} photos without GPS data.`);
      setShowLocationPicker(false);
    } catch (err) {
      setError('Failed to set event location');
      console.error(err);
    }
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
          <EventAnalytics
            stats={stats}
            slug={slug!}
            isExpanded={isAnalyticsExpanded}
            onToggleExpand={() => setIsAnalyticsExpanded(!isAnalyticsExpanded)}
          />
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
        <UploadQueueList
          queueItems={queueItems}
          itemsToShow={queueItemsToShow}
          onLoadMore={() => setQueueItemsToShow(prev => prev + 10)}
        />
        </>
        )}
      </div>

      {/* GPS Location Picker Modal */}
      <EventLocationPicker
        isOpen={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        onSetLocation={handleSetEventLocation}
      />
    </div>
  );
};

export default AdminEventUpload;
