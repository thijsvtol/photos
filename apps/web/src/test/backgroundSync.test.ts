import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPendingUploads,
  updateQueueItem,
  startUpload,
  uploadPart,
  completeUpload,
  cancelUpload,
  uploadVideoPoster,
  computeFileHash,
  captureVideoPoster,
  syncItemProgress,
} = vi.hoisted(() => ({
  getPendingUploads: vi.fn(),
  updateQueueItem: vi.fn(),
  startUpload: vi.fn(),
  uploadPart: vi.fn(),
  completeUpload: vi.fn(),
  cancelUpload: vi.fn(),
  uploadVideoPoster: vi.fn(),
  computeFileHash: vi.fn(),
  captureVideoPoster: vi.fn(),
  syncItemProgress: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(),
  },
}));

vi.mock('@capawesome/capacitor-background-task', () => ({
  BackgroundTask: {
    beforeExit: vi.fn(),
    finish: vi.fn(),
  },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    requestPermissions: vi.fn(),
  },
}));

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn().mockResolvedValue({ connected: true }),
  },
}));

vi.mock('../uploadQueue', () => ({
  getPendingUploads,
  updateQueueItem,
}));

vi.mock('../api', () => ({
  startUpload,
  uploadPart,
  completeUpload,
  cancelUpload,
  uploadVideoPoster,
}));

vi.mock('../services/folderSyncPlugin', () => ({
  default: {
    syncNow: vi.fn(),
  },
}));

vi.mock('../services/uploadManager', () => ({
  uploadManager: {
    syncItemProgress,
  },
}));

vi.mock('../imageUtils', () => ({
  createPreview: vi.fn(),
  computeFileHash,
}));

vi.mock('../utils/videoMetadata', () => ({
  normalizeVideoFileType: (fileType: string, fileName?: string | null) =>
    fileType === 'video/quicktime' || /\.(mp4|mov)$/i.test(fileName || '') ? 'video/mp4' : fileType,
  captureVideoPoster,
}));

vi.mock('../plugins/ProgressNotification', () => ({
  default: {
    show: vi.fn(),
    cancel: vi.fn(),
    consumeCancelRequest: vi.fn().mockResolvedValue({ cancelled: false }),
  },
}));

import { backgroundSyncService } from '../services/backgroundSync';

describe('backgroundSyncService video uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingUploads.mockResolvedValue([]);
    updateQueueItem.mockResolvedValue(undefined);
    startUpload.mockResolvedValue({ uploadId: 'upload-1', key: 'original/event/photo.mp4' });
    uploadPart.mockResolvedValue({ etag: 'etag-1' });
    completeUpload.mockResolvedValue(undefined);
    cancelUpload.mockResolvedValue(undefined);
    uploadVideoPoster.mockResolvedValue(undefined);
    computeFileHash.mockResolvedValue('hash-1');
    captureVideoPoster.mockResolvedValue(null);
  });

  it('passes the normalized video MIME type on part uploads', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mov', { type: 'video/quicktime' });
    getPendingUploads.mockResolvedValue([
      {
        id: 'upload-queue-1',
        eventSlug: 'event',
        file,
        fileType: 'video/quicktime',
        status: 'pending',
        progress: 0,
        photoId: 'photo-1',
      },
    ]);

    await backgroundSyncService.syncNow();

    expect(startUpload).toHaveBeenCalledTimes(1);
    expect(startUpload.mock.calls[0][17]).toBe('video/mp4');
    expect(uploadPart).toHaveBeenCalledTimes(1);
    expect(uploadPart.mock.calls[0][5]).toBe(false);
    expect(uploadPart.mock.calls[0][6]).toBe('video/mp4');
  });
});
