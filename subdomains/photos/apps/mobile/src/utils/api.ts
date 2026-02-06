import axios, { AxiosInstance } from 'axios';
import { Event, UploadResponse, PartUploadResponse } from '../types';

export class ApiClient {
  private client: AxiosInstance;
  private adminSecret: string;

  constructor(baseURL: string, adminSecret: string) {
    this.adminSecret = adminSecret;
    this.client = axios.create({
      baseURL,
      headers: {
        'X-Admin-Secret': adminSecret,
      },
    });
  }

  updateConfig(baseURL: string, adminSecret: string) {
    this.adminSecret = adminSecret;
    this.client = axios.create({
      baseURL,
      headers: {
        'X-Admin-Secret': adminSecret,
      },
    });
  }

  async getEvents(): Promise<Event[]> {
    const response = await this.client.get('/api/events');
    return response.data.events || [];
  }

  async startUpload(
    eventSlug: string,
    photoId: string,
    filename: string,
    metadata: {
      width?: number;
      height?: number;
      captureTime?: string;
      cameraMake?: string;
      cameraModel?: string;
      lensModel?: string;
      focalLength?: number;
      aperture?: number;
      shutterSpeed?: string;
      iso?: number;
      latitude?: number;
      longitude?: number;
    }
  ): Promise<UploadResponse> {
    const response = await this.client.post(
      `/api/admin/events/${eventSlug}/uploads/start`,
      {
        photoId,
        filename,
        ...metadata,
      }
    );
    return response.data;
  }

  async uploadPart(
    eventSlug: string,
    photoId: string,
    partNumber: number,
    uploadId: string,
    data: ArrayBuffer
  ): Promise<PartUploadResponse> {
    const response = await this.client.put(
      `/api/admin/events/${eventSlug}/uploads/${photoId}/parts/${partNumber}`,
      data,
      {
        headers: {
          'X-Upload-Id': uploadId,
          'Content-Type': 'application/octet-stream',
        },
      }
    );
    return response.data;
  }

  async completeUpload(
    eventSlug: string,
    photoId: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<void> {
    await this.client.post(
      `/api/admin/events/${eventSlug}/uploads/${photoId}/complete`,
      {
        uploadId,
        parts,
      }
    );
  }
}
