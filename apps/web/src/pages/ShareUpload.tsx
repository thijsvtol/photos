import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { ulid } from 'ulid';
import ExifReader from 'exifreader';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { useAuth } from '../contexts/AuthContext';
import AlbumPicker from '../components/AlbumPicker';
import { addToQueue } from '../uploadQueue';
import type { UploadQueueItem } from '../types';
import { backgroundSyncService } from '../services/backgroundSync';
import { extractMp4CreationTime } from '../utils/videoMetadata';

interface SharedFile {
  name: string;
  path: string;
  uri: string;
  mimeType: string;
  size: number;
}

interface LocationState {
  sharedFiles: SharedFile[];
}

/**
 * ShareUpload page handles photos/videos shared from other apps.
 * Flow:
 * 1. Check authentication (redirect to OAuth if not logged in)
 * 2. Show album picker
 * 3. Process shared files (EXIF extraction, queue addition)
 * 4. Start background upload
 * 5. Show success confirmation
 */
export default function ShareUpload() {
  const { user, loading: authLoading, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState;
  
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'processing' | 'uploading' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Load shared files from state or sessionStorage
  useEffect(() => {
    console.log('[ShareUpload] Component mounted');
    console.log('[ShareUpload] location.state:', state);
    
    // Try to get shared files from location state first
    let files = state?.sharedFiles;
    
    // If not in state, check sessionStorage
    if (!files || files.length === 0) {
      console.log('[ShareUpload] No files in state, checking sessionStorage');
      const pendingShare = sessionStorage.getItem('pendingShare');
      if (pendingShare) {
        try {
          files = JSON.parse(pendingShare);
          console.log('[ShareUpload] Loaded', files.length, 'files from sessionStorage');
        } catch (error) {
          console.error('[ShareUpload] Failed to parse sessionStorage:', error);
        }
      }
    }

    // If we have files, store them and clear sessionStorage
    if (files && files.length > 0) {
      setSharedFiles(files);
      sessionStorage.removeItem('pendingShare');
      console.log('[ShareUpload] Set', files.length, 'shared files');
    } else {
      console.log('[ShareUpload] No files found, redirecting to home');
      navigate('/', { replace: true });
    }
  }, []);

  // Handle authentication and show album picker
  useEffect(() => {
    // Wait for files to be loaded
    if (sharedFiles.length === 0) {
      return;
    }

    // Wait for auth context to load
    if (authLoading) {
      console.log('[ShareUpload] Waiting for auth to load...');
      return;
    }

    // If not authenticated, redirect to OAuth
    if (!user) {
      console.log('[ShareUpload] Not authenticated, starting auth flow');
      handleLogin();
      return;
    }

    // Show album picker once authenticated
    console.log('[ShareUpload] User authenticated, showing album picker');
    setShowAlbumPicker(true);
  }, [user, authLoading, sharedFiles]);

  const handleLogin = async () => {
    try {
      // Use the login function from AuthContext which handles redirect properly
      login();
    } catch (error) {
      console.error('Failed to start auth flow:', error);
      setUploadStatus('error');
      setStatusMessage('Authentication failed. Please try again.');
    }
  };

  const handleAlbumSelected = async (albumSlug: string) => {
    setShowAlbumPicker(false);
    setUploadStatus('processing');
    setStatusMessage('Processing files...');
    
    await processSharedFiles(albumSlug);
  };

  const parseExifDate = (exifDate: string): string | undefined => {
    try {
      const cleaned = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const date = new Date(cleaned);
      if (isNaN(date.getTime())) {
        return undefined;
      }
      return date.toISOString();
    } catch {
      return undefined;
    }
  };

  const extractExifData = async (fileUri: string): Promise<{
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
      // Read file from native file system using Capacitor Filesystem API
      let buffer: ArrayBuffer;
      
      if (Capacitor.isNativePlatform()) {
        // On native, use Filesystem API to read the file
        const filePath = fileUri.replace('file://', '');
        const result = await Filesystem.readFile({
          path: filePath
        });
        
        // result.data is a base64 string, convert to ArrayBuffer
        const base64Data = result.data as string;
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        buffer = bytes.buffer;
      } else {
        // On web, use fetch (shouldn't happen in this flow)
        const response = await fetch(fileUri);
        buffer = await response.arrayBuffer();
      }
      
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

      // Generate blur placeholder
      let blurPlaceholder: string | undefined;
      try {
        // Create blob from buffer
        const blob = new Blob([buffer], { type: 'image/jpeg' });
        const img = new Image();
        const url = URL.createObjectURL(blob);
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

  const processSharedFiles = async (albumSlug: string) => {
    try {
      console.log('[ShareUpload] Processing', sharedFiles.length, 'files for album:', albumSlug);
      const files = sharedFiles;
      
      for (let i = 0; i < files.length; i++) {
        const sharedFile = files[i];
        console.log('[ShareUpload] Processing file', i + 1, 'of', files.length, ':', sharedFile.name);
        setStatusMessage(`Processing file ${i + 1} of ${files.length}...`);
        
        const id = ulid();
        const photoId = ulid();
        const isVideo = sharedFile.mimeType.startsWith('video/');
        
        // Read file from native cache using Capacitor Filesystem API
        let blob: Blob;
        let fileBuffer: ArrayBuffer | undefined;
        
        if (Capacitor.isNativePlatform()) {
          console.log('[ShareUpload] Reading file from:', sharedFile.uri);
          const filePath = sharedFile.uri.replace('file://', '');
          const result = await Filesystem.readFile({
            path: filePath
          });
          
          console.log('[ShareUpload] File read, converting base64 to blob...');
          // Convert base64 to blob
          const base64Data = result.data as string;
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }
          fileBuffer = bytes.buffer;
          blob = new Blob([bytes], { type: sharedFile.mimeType });
          console.log('[ShareUpload] Blob created, size:', blob.size);
        } else {
          // On web, use fetch (shouldn't happen in this flow)
          const response = await fetch(sharedFile.uri);
          blob = await response.blob();
          fileBuffer = await blob.arrayBuffer();
        }
        
        const file = new File([blob], sharedFile.name, { type: sharedFile.mimeType });
        console.log('[ShareUpload] File created, extracting metadata...');
        
        // Extract metadata: EXIF for images, MP4 creation time for videos
        let exif: Awaited<ReturnType<typeof extractExifData>> = {};
        if (isVideo) {
          const captureTime = fileBuffer ? extractMp4CreationTime(fileBuffer) : undefined;
          exif = { captureTime };
        } else {
          exif = await extractExifData(sharedFile.uri);
        }
        console.log('[ShareUpload] Metadata extracted:', exif);
        
        const item: UploadQueueItem = {
          id,
          eventSlug: albumSlug,
          file,
          fileType: sharedFile.mimeType,
          status: 'pending',
          progress: 0,
          photoId,
          ...exif,
        };
        
        console.log('[ShareUpload] Adding to queue:', item.id);
        await addToQueue(item);
        console.log('[ShareUpload] Successfully added to queue');
      }
      
      console.log('[ShareUpload] All files processed, starting upload...');
      setUploadStatus('uploading');
      setStatusMessage(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
      
      // Trigger immediate upload
      console.log('[ShareUpload] Triggering immediate upload...');
      backgroundSyncService.syncNow();
      console.log('[ShareUpload] Upload triggered');
      
      // Show success after a brief delay
      setTimeout(() => {
        setUploadStatus('success');
        setStatusMessage(`Successfully queued ${files.length} file${files.length > 1 ? 's' : ''} for upload. You can close this app now.`);
        console.log('[ShareUpload] Upload success shown');
        
        // Navigate to home after 3 seconds
        setTimeout(() => {
          console.log('[ShareUpload] Navigating to home');
          navigate('/', { replace: true });
        }, 3000);
      }, 1000);
      
    } catch (error) {
      console.error('[ShareUpload] Failed to process shared files:', error);
      console.error('[ShareUpload] Error details:', JSON.stringify(error));
      setUploadStatus('error');
      setStatusMessage(`Failed to process files: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (authLoading || sharedFiles.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Album Picker Modal */}
        {showAlbumPicker && (
          <AlbumPicker
            isOpen={showAlbumPicker}
            onClose={() => {
              navigate('/', { replace: true });
            }}
            onSelectAlbum={handleAlbumSelected}
          />
        )}

        {/* Status Display */}
        {uploadStatus !== 'idle' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-xl text-center">
            {uploadStatus === 'processing' && (
              <>
                <Loader2 className="w-16 h-16 animate-spin text-blue-600 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  Processing Files
                </h2>
                <p className="text-gray-600 dark:text-gray-400">{statusMessage}</p>
              </>
            )}

            {uploadStatus === 'uploading' && (
              <>
                <Upload className="w-16 h-16 text-blue-600 mx-auto mb-4 animate-pulse" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  Uploading
                </h2>
                <p className="text-gray-600 dark:text-gray-400">{statusMessage}</p>
              </>
            )}

            {uploadStatus === 'success' && (
              <>
                <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  Success!
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-4">{statusMessage}</p>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                  Files will continue uploading in the background
                </p>
              </>
            )}

            {uploadStatus === 'error' && (
              <>
                <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  Upload Failed
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-4">{statusMessage}</p>
                <button
                  onClick={() => navigate('/', { replace: true })}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Go Home
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
