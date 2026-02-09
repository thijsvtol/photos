import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
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

  useEffect(() => {
    if (slug) {
      loadEvent();
      loadStats();
      loadQueue();
      // Resume any pending uploads
      resumePendingUploads();
    }
  }, [slug]);

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
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <div className="mb-8">
          <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
            ← Back to Admin
          </Link>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-4xl font-bold text-gray-900">{event?.name}</h1>
              <p className="text-gray-600 mt-2">Upload photos to this event</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLocationPicker(true)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                📍 Set GPS Location
              </button>
              <button
                onClick={handleRegenerateThumbnails}
                disabled={isRegenerating}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isRegenerating ? 'Regenerating...' : '🔄 Regenerate Thumbnails'}
              </button>
              <button
                onClick={handleGeocodePhotos}
                disabled={isGeocoding}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
                title="Fetch city names for photos with GPS coordinates"
              >
                {isGeocoding ? 'Geocoding...' : '🌍 Geocode Cities'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Event Analytics */}
        {stats && (
          <div className="mb-8">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">📊 Event Analytics</h2>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-900">{stats.photoCount}</div>
                  <div className="text-sm text-blue-700">Total Photos</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-900">{stats.photosWithGPS}</div>
                  <div className="text-sm text-green-700">With GPS Data</div>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-yellow-900">{stats.featuredCount}</div>
                  <div className="text-sm text-yellow-700">Featured Photos</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-red-900">{stats.totalFavorites}</div>
                  <div className="text-sm text-red-700">Total Favorites</div>
                </div>
              </div>

              {stats.topFavorites && stats.topFavorites.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">⭐ Top Favorited Photos</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {stats.topFavorites.map((photo) => (
                      <div key={photo.id} className="relative group">
                        <img
                          src={getPreviewUrl(slug!, photo.id)}
                          alt={photo.original_filename}
                          className="w-full aspect-square object-cover rounded-lg shadow"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white px-2 py-1 rounded-b-lg text-xs">
                          ❤️ {photo.favorites_count}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.cameraModels && stats.cameraModels.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">📷 Cameras Used</h3>
                  <div className="flex flex-wrap gap-2">
                    {stats.cameraModels.map((camera, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                      >
                        {camera.camera_model} ({camera.count})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6">
                <Link
                  to={`/events/${slug}`}
                  className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  👁️ View Gallery
                </Link>
                <p className="text-sm text-gray-500 mt-2">
                  View the gallery as admin to manage photos (delete, mark as featured)
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-4 border-dashed rounded-lg p-12 mb-8 text-center transition ${
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'
          }`}
        >
          <div className="text-6xl mb-4">📷</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            Drag & Drop Photos Here
          </h3>
          <p className="text-gray-600 mb-4">or</p>
          <label className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition cursor-pointer inline-block">
            Browse Files
            <input
              type="file"
              multiple
              accept="image/jpeg,video/mp4"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
          <p className="text-sm text-gray-500 mt-4">Supports JPEG images and MP4 videos</p>
        </div>

        {/* Folder Sync Manager - Mobile only */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <FolderSyncManager eventSlug={slug!} />
        </div>

        {/* Upload Queue */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-semibold mb-4">Upload Queue</h2>
          
          {queueItems.length === 0 ? (
            <p className="text-gray-600">No uploads in queue</p>
          ) : (
            <div className="space-y-4">
              {queueItems.map((item) => (
                <div key={item.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium">{item.file.name}</p>
                      <p className="text-sm text-gray-600">
                        {(item.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded text-white text-sm ${getStatusColor(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                  
                  {item.status === 'uploading' && (
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${item.progress}%` }}
                      ></div>
                    </div>
                  )}
                  
                  {item.status === 'uploading' && (
                    <p className="text-sm text-gray-600">{item.progress}%</p>
                  )}
                  
                  {item.status === 'failed' && (
                    <p className="text-sm text-red-600">{item.error}</p>
                  )}
                  
                  {item.captureTime && (
                    <p className="text-sm text-gray-600 mt-2">
                      Captured: {new Date(item.captureTime).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* GPS Location Picker Modal */}
      {showLocationPicker && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full h-[600px] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Set GPS Location for Event</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Click on the map to select a location. This will update photos without GPS data.
                </p>
              </div>
              <button onClick={() => setShowLocationPicker(false)} className="text-gray-600 hover:text-gray-900">
                ✕
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
            <div className="p-4 border-t flex justify-between items-center">
              <div className="text-sm text-gray-600">
                {selectedLocation
                  ? `Selected: ${selectedLocation[0].toFixed(6)}, ${selectedLocation[1].toFixed(6)}`
                  : 'Click on the map to select a location'}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLocationPicker(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSetEventLocation}
                  disabled={!selectedLocation}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  Set Location
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
