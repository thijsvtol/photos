/**
 * Shared helpers for deriving storage details from a photo's `file_type`.
 *
 * `file_type` is one of:
 *  - 'video/mp4'      — video upload
 *  - 'image/jpeg'      — standard JPEG photo upload
 *  - 'image/png'       — PNG photo upload. Like RAW, the client's generated
 *                        preview is always a JPEG (createPreview renders via
 *                        canvas), so only the ORIGINAL keeps the real .png
 *                        extension/content-type.
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

export function isPngFileType(fileType: string | null | undefined): boolean {
  return fileType === 'image/png';
}

/** Extension (no leading dot) for the RAW original, e.g. 'raw/cr2' -> 'cr2'. */
function rawExtension(fileType: string): string {
  const ext = fileType.slice('raw/'.length).toLowerCase();
  return ext || 'raw';
}

/**
 * Extension to use for a given storage folder.
 * - 'preview' is always .jpg for images (including RAW/PNG) and .mp4 for video.
 * - 'original' keeps the real RAW/PNG extension for those uploads.
 */
export function getStorageExtension(fileType: string | null | undefined, folder: 'preview' | 'original'): string {
  const type = fileType || 'image/jpeg';
  if (isVideoFileType(type)) return 'mp4';
  if (folder === 'original' && isRawFileType(type)) return rawExtension(type);
  if (folder === 'original' && isPngFileType(type)) return 'png';
  return 'jpg';
}

/** Content-Type header to serve for a given storage folder. */
export function getStorageContentType(fileType: string | null | undefined, folder: 'preview' | 'original'): string {
  const type = fileType || 'image/jpeg';
  if (isVideoFileType(type)) return 'video/mp4';
  if (folder === 'original' && isRawFileType(type)) return 'application/octet-stream';
  if (folder === 'original' && isPngFileType(type)) return 'image/png';
  return 'image/jpeg';
}
