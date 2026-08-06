import { registerPlugin } from '@capacitor/core';

/**
 * A single file entry returned by the SAF directory listing.
 */
export interface SafFileEntry {
  /** Display name of the file (e.g. "IMG_20260212.jpg") */
  name: string;
  /** content:// URI that can be passed to Filesystem.readFile() */
  uri: string;
  /** SAF document id — stable for a given file even if the tree is re-picked */
  docId: string;
  /** MIME type (e.g. "image/jpeg") */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp in milliseconds */
  mtime: number;
}

export interface SafListResult {
  files: SafFileEntry[];
}

export interface SafDirectoryPlugin {
  /**
   * List media files in a directory identified by a SAF tree URI.
   * Uses Android's DocumentsContract API, which works under scoped storage.
   *
   * @param recursive descend into subdirectories (default false)
   * @param since only return files modified after this epoch-ms timestamp
   * @param limit stop after this many files (0/omitted for unlimited)
   */
  listFiles(options: {
    treeUri: string;
    recursive?: boolean;
    since?: number;
    limit?: number;
  }): Promise<SafListResult>;

  /**
   * Decode a single SAF document down to a ~1920px JPEG and return it as
   * base64.
   *
   * Uses BitmapFactory's subsampled decode natively, so it never allocates the
   * full-resolution bitmap — unlike Filesystem.readFile(), which ships the
   * entire original across the bridge as base64 and can exhaust the WebView's
   * memory on a large photo. Used by faceDetectionQueue.ts to run detection on
   * photos the native folder-sync engine uploaded.
   */
  readPreview(options: { uri: string }): Promise<{ data: string; mimeType: string }>;

  /**
   * Write a file to a directory identified by a SAF tree URI.
   * Creates a new document in the tree and writes the base64 data to it.
   */
  writeFile(options: { treeUri: string; filename: string; data: string; mimeType: string }): Promise<{ uri: string }>;
}

/**
 * Native plugin bridge for listing SAF directory contents.
 * Falls back to a web stub that always returns empty (folder sync is mobile-only).
 */
const SafDirectory = registerPlugin<SafDirectoryPlugin>('SafDirectory');

export default SafDirectory;
