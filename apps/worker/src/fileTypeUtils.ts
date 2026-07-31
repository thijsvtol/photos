/**
 * Shared helpers for deriving storage details from a photo's `file_type`.
 *
 * `file_type` is one of:
 *  - 'video/mp4'      — video upload
 *  - 'image/jpeg'      — standard JPEG photo upload
 *  - 'raw/<ext>'       — a camera RAW photo (e.g. 'raw/cr2', 'raw/nef'). The
 *                        client always generates and uploads a real JPEG
 *                        preview for these (browsers/canvas can't decode RAW),
 *                        so only the ORIGINAL file keeps the real RAW
 *                        extension — the preview is always stored as .jpg.
 */

export function isVideoFileType(fileType: string | null | undefined): boolean {
  return fileType === 'video/mp4';
}

export function isRawFileType(fileType: string | null | undefined): boolean {
  return !!fileType && fileType.startsWith('raw/');
}

/** Extension (no leading dot) for the RAW original, e.g. 'raw/cr2' -> 'cr2'. */
function rawExtension(fileType: string): string {
  const ext = fileType.slice('raw/'.length).toLowerCase();
  return ext || 'raw';
}

/**
 * Extension to use for a given storage folder.
 * - 'preview' is always .jpg for images (including RAW) and .mp4 for video.
 * - 'original' keeps the real RAW extension for RAW uploads.
 */
export function getStorageExtension(fileType: string | null | undefined, folder: 'preview' | 'original'): string {
  const type = fileType || 'image/jpeg';
  if (isVideoFileType(type)) return 'mp4';
  if (folder === 'original' && isRawFileType(type)) return rawExtension(type);
  return 'jpg';
}

/** Content-Type header to serve for a given storage folder. */
export function getStorageContentType(fileType: string | null | undefined, folder: 'preview' | 'original'): string {
  const type = fileType || 'image/jpeg';
  if (isVideoFileType(type)) return 'video/mp4';
  if (folder === 'original' && isRawFileType(type)) return 'application/octet-stream';
  return 'image/jpeg';
}
