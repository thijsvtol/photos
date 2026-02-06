import * as FileSystem from 'expo-file-system';
import { ApiClient } from './api';
import { UploadQueueItem } from '../types';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

export class UploadManager {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Upload a photo with multipart upload support
   */
  async uploadPhoto(
    item: UploadQueueItem,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    try {
      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(item.uri);
      if (!fileInfo.exists) {
        throw new Error('File not found');
      }

      const fileSize = fileInfo.size || 0;

      // Start the multipart upload
      const { uploadId, key } = await this.apiClient.startUpload(
        item.eventSlug,
        item.id,
        item.filename,
        {
          width: item.width,
          height: item.height,
          captureTime: item.exif?.DateTimeOriginal || new Date().toISOString(),
          cameraMake: item.exif?.Make,
          cameraModel: item.exif?.Model,
          lensModel: item.exif?.LensModel,
          focalLength: item.exif?.FocalLength,
          aperture: item.exif?.FNumber,
          shutterSpeed: item.exif?.ExposureTime,
          iso: item.exif?.ISOSpeedRatings,
          latitude: item.exif?.GPSLatitude,
          longitude: item.exif?.GPSLongitude,
        }
      );

      // Read file and split into chunks
      const parts: Array<{ partNumber: number; etag: string }> = [];
      const totalParts = Math.ceil(fileSize / CHUNK_SIZE);

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileSize);

        // Read chunk from file
        const chunk = await FileSystem.readAsStringAsync(item.uri, {
          encoding: 'base64',
          position: start,
          length: end - start,
        });

        // Convert base64 to ArrayBuffer
        const binaryString = atob(chunk);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Upload the part
        const partResponse = await this.apiClient.uploadPart(
          item.eventSlug,
          item.id,
          partNumber,
          uploadId,
          bytes.buffer
        );

        parts.push({
          partNumber,
          etag: partResponse.etag,
        });

        // Update progress
        const progress = (partNumber / totalParts) * 100;
        onProgress?.(progress);
      }

      // Complete the upload
      await this.apiClient.completeUpload(
        item.eventSlug,
        item.id,
        uploadId,
        parts
      );
    } catch (error) {
      console.error('Upload failed:', error);
      throw error;
    }
  }
}
