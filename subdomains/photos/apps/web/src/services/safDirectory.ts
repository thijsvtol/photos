import { registerPlugin } from '@capacitor/core';

/**
 * A single file entry returned by the SAF directory listing.
 */
export interface SafFileEntry {
  /** Display name of the file (e.g. "IMG_20260212.jpg") */
  name: string;
  /** content:// URI that can be passed to Filesystem.readFile() */
  uri: string;
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
   * List files in a directory identified by a SAF tree URI.
   * Uses Android's DocumentsContract API, which works under scoped storage.
   */
  listFiles(options: { treeUri: string }): Promise<SafListResult>;
}

/**
 * Native plugin bridge for listing SAF directory contents.
 * Falls back to a web stub that always returns empty (folder sync is mobile-only).
 */
const SafDirectory = registerPlugin<SafDirectoryPlugin>('SafDirectory');

export default SafDirectory;
