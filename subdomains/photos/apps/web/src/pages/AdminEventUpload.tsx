import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ulid } from 'ulid';
import ExifReader from 'exifreader';
import { getEvent, startUpload, getPartUploadUrl, completeUpload } from '../api';
import { addToQueue, updateQueueItem, getQueueItems, getPendingUploads } from '../uploadQueue';
import type { Event, UploadQueueItem } from '../types';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

const AdminEventUpload: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (slug) {
      loadEvent();
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

  const extractExifData = async (file: File): Promise<{ captureTime?: string; width?: number; height?: number }> => {
    try {
      const buffer = await file.arrayBuffer();
      const tags = ExifReader.load(buffer);
      
      const captureTime = tags.DateTimeOriginal?.description;
      const width = tags.PixelXDimension?.value || tags['Image Width']?.value;
      const height = tags.PixelYDimension?.value || tags['Image Height']?.value;
      
      return {
        captureTime: captureTime ? new Date(captureTime).toISOString() : undefined,
        width: typeof width === 'number' ? width : undefined,
        height: typeof height === 'number' ? height : undefined,
      };
    } catch (err) {
      console.error('Failed to extract EXIF:', err);
      return {};
    }
  };

  const handleFiles = async (files: FileList) => {
    const jpegFiles = Array.from(files).filter(f => f.type === 'image/jpeg');
    
    for (const file of jpegFiles) {
      const id = ulid();
      const photoId = ulid();
      
      const exif = await extractExifData(file);
      
      const item: UploadQueueItem = {
        id,
        eventSlug: slug!,
        file,
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
      
      // Start multipart upload
      const { uploadId } = await startUpload(
        item.eventSlug,
        item.photoId!,
        item.file.name,
        item.captureTime,
        item.width,
        item.height
      );
      
      await updateQueueItem(item.id, { uploadId });
      
      // Upload parts
      const parts: Array<{ partNumber: number; etag: string }> = [];
      const totalParts = Math.ceil(item.file.size / CHUNK_SIZE);
      
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, item.file.size);
        const chunk = item.file.slice(start, end);
        
        // Get presigned URL
        const { uploadUrl } = await getPartUploadUrl(
          item.eventSlug,
          item.photoId!,
          uploadId,
          partNumber
        );
        
        // Upload part
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          body: chunk,
        });
        
        if (!response.ok) {
          throw new Error(`Failed to upload part ${partNumber}`);
        }
        
        const etag = response.headers.get('ETag')?.replace(/"/g, '') || '';
        parts.push({ partNumber, etag });
        
        // Update progress
        const progress = Math.round((partNumber / totalParts) * 100);
        await updateQueueItem(item.id, { progress, parts });
        setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, progress, parts } : i));
      }
      
      // Complete upload
      await completeUpload(item.eventSlug, item.photoId!, uploadId, parts);
      
      await updateQueueItem(item.id, { status: 'completed', progress: 100 });
      setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'completed', progress: 100 } : i));
    } catch (err) {
      console.error('Upload failed:', err);
      await updateQueueItem(item.id, { status: 'failed', error: String(err) });
      setQueueItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'failed', error: String(err) } : i));
    }
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
            ← Back to Admin
          </Link>
          <h1 className="text-4xl font-bold text-gray-900">{event?.name}</h1>
          <p className="text-gray-600 mt-2">Upload photos to this event</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
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
              accept="image/jpeg"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
          <p className="text-sm text-gray-500 mt-4">Only JPEG files are supported</p>
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
    </div>
  );
};

export default AdminEventUpload;
