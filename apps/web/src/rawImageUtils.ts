/**
 * Client-side support for camera RAW photo formats (.cr2, .nef, .arw, .dng, etc).
 *
 * Browsers/canvas cannot decode RAW containers directly (only an `<img>`/canvas
 * pipeline is available for standard formats like JPEG), so RAW files need a
 * dedicated decode step before we can generate the JPEG "preview" that the rest
 * of the app relies on for fast gallery/grid rendering. We use `libraw-wasm`
 * (LibRaw compiled to WebAssembly, running in a Web Worker) for this — it runs
 * entirely client-side, mirroring how JPEG previews are already generated in
 * imageUtils.ts, so the worker/backend never needs to understand RAW pixel data.
 *
 * Two decode strategies, cheapest first:
 *  1. Extract the camera's embedded JPEG preview (present in nearly every RAW
 *     file — it's what the camera's own LCD/software use for fast previews)
 *     and resize it exactly like a normal JPEG upload. This is fast and low
 *     memory since it skips demosaicing entirely.
 *  2. Fall back to a full RAW decode (demosaic) if no embedded JPEG preview is
 *     available, building an ImageData buffer directly from the decoded pixels.
 * If both fail (corrupt/unsupported file), we fall back to a generic "RAW"
 * placeholder image so the upload is never blocked — the original file is
 * still stored untouched either way.
 */
import { resizeImage } from './imageUtils';

/** Common camera RAW file extensions (lowercase, without the leading dot). */
export const RAW_EXTENSIONS = new Set([
  'cr2', 'cr3', 'crw', // Canon
  'nef', 'nrw', // Nikon
  'arw', 'srf', 'sr2', // Sony
  'dng', // Adobe / many phones
  'raf', // Fujifilm
  'orf', // Olympus
  'rw2', // Panasonic
  'pef', 'ptx', // Pentax
  'srw', // Samsung
  'raw', 'rwl', // Leica / generic
  'erf', // Epson
  'kdc', 'dcr', // Kodak
  'mrw', // Minolta
  'x3f', // Sigma
  '3fr', 'mef', 'mos', 'iiq', // misc medium format
]);

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

/** RAW files are identified by extension, not MIME type — browsers frequently
 *  report an empty or vendor-specific `file.type` for RAW containers. */
export function isRawFile(file: File): boolean {
  return RAW_EXTENSIONS.has(getFileExtension(file.name));
}

/** The `fileType` value stored for RAW uploads: `raw/<extension>`, e.g. `raw/cr2`.
 *  Keeping the real extension lets the worker store/serve the original file
 *  with its correct extension while the generated preview stays a plain JPEG. */
export function getRawFileType(file: File): string {
  return `raw/${getFileExtension(file.name) || 'raw'}`;
}

export function isRawFileType(fileType: string | undefined | null): boolean {
  return !!fileType && fileType.startsWith('raw/');
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode canvas to JPEG'))),
      'image/jpeg',
      quality
    );
  });
}

/** Downscale a canvas to at most `maxWidth` wide (keeping aspect ratio), matching
 *  the same 1920px cap used for regular JPEG previews (imageUtils.createPreview). */
function downscaleCanvas(canvas: HTMLCanvasElement, maxWidth: number): HTMLCanvasElement {
  if (canvas.width <= maxWidth) return canvas;
  const ratio = maxWidth / canvas.width;
  const out = createCanvas(maxWidth, Math.round(canvas.height * ratio));
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/** Build a canvas from a raw RGB(A) pixel buffer (8-bit or 16-bit per channel). */
function pixelBufferToCanvas(
  width: number,
  height: number,
  colors: number,
  data: Uint8Array | Uint16Array
): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  const imageData = ctx.createImageData(width, height);
  const out = imageData.data;
  const is16Bit = 'BYTES_PER_ELEMENT' in data && data.BYTES_PER_ELEMENT === 2;
  const maxVal = is16Bit ? 65535 : 255;
  const toByte = (v: number) => (is16Bit ? Math.round((v / maxVal) * 255) : v);

  const pixelCount = width * height;
  for (let i = 0, o = 0; i < pixelCount; i++, o += 4) {
    if (colors >= 3) {
      out[o] = toByte(data[i * colors]);
      out[o + 1] = toByte(data[i * colors + 1]);
      out[o + 2] = toByte(data[i * colors + 2]);
    } else {
      const v = toByte(data[i]);
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
    }
    out[o + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Generic placeholder shown when a RAW file can't be decoded at all (corrupt
 *  file, or a compression variant this LibRaw build doesn't support) — the
 *  original file still uploads fine, only the preview thumbnail is generic. */
export async function createRawPlaceholder(): Promise<Blob> {
  const canvas = createCanvas(640, 480);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
  ctx.fillStyle = '#9ca3af';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RAW', canvas.width / 2, canvas.height / 2);
  return canvasToJpegBlob(canvas, 0.9);
}

/**
 * Decode a RAW file client-side and produce a real JPEG preview (same 1920px
 * cap / 0.85 quality as other photo previews). Falls back to a generic
 * placeholder if decoding fails for any reason — this function never throws.
 */
export async function createRawPreview(file: File): Promise<Blob> {
  const { default: LibRaw } = await import('libraw-wasm');
  const raw = new LibRaw();

  try {
    const buffer = await file.arrayBuffer();
    await raw.open(new Uint8Array(buffer));

    // Fast path: use the camera's embedded JPEG preview when available.
    try {
      const thumb = await raw.thumbnailData();
      if (thumb && thumb.data.length > 0) {
        if (thumb.format === 'jpeg') {
          // TS's DOM lib types Uint8Array as generic over ArrayBufferLike
          // (which includes SharedArrayBuffer), while the Blob/File
          // constructor's BlobPart wants ArrayBufferView<ArrayBuffer>
          // specifically. thumb.data is always a plain (non-shared)
          // Uint8Array at runtime, so this cast is safe.
          const jpegBlob = new File([thumb.data as unknown as BlobPart], file.name, { type: 'image/jpeg' });
          return await resizeImage(jpegBlob, { maxWidth: 1920, quality: 0.85 });
        }
        if (thumb.format === 'bitmap' && thumb.width && thumb.height) {
          const canvas = pixelBufferToCanvas(thumb.width, thumb.height, 3, thumb.data);
          return await canvasToJpegBlob(downscaleCanvas(canvas, 1920), 0.85);
        }
      }
    } catch (thumbErr) {
      console.warn('[rawImageUtils] Embedded thumbnail extraction failed, falling back to full decode:', thumbErr);
    }

    // Slow fallback: fully demosaic the sensor data.
    const decoded = await raw.imageData();
    if (decoded && decoded.width && decoded.height) {
      const canvas = pixelBufferToCanvas(decoded.width, decoded.height, decoded.colors, decoded.data);
      return await canvasToJpegBlob(downscaleCanvas(canvas, 1920), 0.85);
    }

    throw new Error('RAW decode produced no image data');
  } catch (err) {
    console.error('[rawImageUtils] Failed to generate RAW preview, using placeholder:', err);
    return createRawPlaceholder();
  } finally {
    raw.dispose();
  }
}
