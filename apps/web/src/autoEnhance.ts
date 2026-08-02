/**
 * One-tap "Auto Enhance" — a pure client-side Canvas algorithm (gray-world
 * auto white balance + per-channel histogram stretch/contrast), the same
 * category of one-tap fix Google Photos offers, at zero server cost. Reuses
 * the same Canvas-based approach already used elsewhere in this app for
 * preview/blur-placeholder generation (see imageUtils.ts).
 */

/** Loads an image URL (same-origin or CORS-enabled) into an HTMLImageElement. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for auto-enhance'));
    img.src = url;
  });
}

/**
 * Applies gray-world auto white balance (scales each channel so its average
 * matches the overall average brightness) followed by a 1% linear contrast
 * stretch (clips the darkest/lightest 1% of pixels per channel and expands
 * the rest to fill 0-255). Runs in a single pass to keep large photos fast.
 */
function enhanceImageData(imageData: ImageData): void {
  const { data } = imageData;
  const pixelCount = data.length / 4;

  // Pass 1: per-channel sums (for gray-world white balance) and histograms
  // (for contrast stretch).
  let sumR = 0, sumG = 0, sumB = 0;
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    sumR += r; sumG += g; sumB += b;
    histR[r]++; histG[g]++; histB[b]++;
  }
  const avgR = sumR / pixelCount;
  const avgG = sumG / pixelCount;
  const avgB = sumB / pixelCount;
  const avgGray = (avgR + avgG + avgB) / 3;

  // Clamp white-balance gains to a sane range so near-monochrome images
  // (e.g. mostly-black or mostly-white photos) don't get wildly over-corrected.
  const clampGain = (gain: number) => Math.min(1.5, Math.max(0.67, gain));
  const gainR = clampGain(avgGray / (avgR || 1));
  const gainG = clampGain(avgGray / (avgG || 1));
  const gainB = clampGain(avgGray / (avgB || 1));

  // Find the 1st/99th percentile per channel for the contrast stretch,
  // computed AFTER conceptually applying the white-balance gain (approximated
  // by just stretching the balanced range below — good enough for a one-tap
  // auto-fix, not a professional color pipeline).
  const percentileBounds = (hist: Uint32Array, gain: number): [number, number] => {
    const clipCount = pixelCount * 0.01;
    let seen = 0, low = 0;
    for (; low < 256; low++) {
      seen += hist[low];
      if (seen >= clipCount) break;
    }
    seen = 0;
    let high = 255;
    for (; high >= 0; high--) {
      seen += hist[high];
      if (seen >= clipCount) break;
    }
    if (high <= low) return [0, 255];
    return [Math.min(255, low * gain), Math.max(0, high * gain)];
  };
  const [lowR, highR] = percentileBounds(histR, gainR);
  const [lowG, highG] = percentileBounds(histG, gainG);
  const [lowB, highB] = percentileBounds(histB, gainB);

  const stretch = (value: number, gain: number, low: number, high: number): number => {
    const balanced = value * gain;
    if (high <= low) return Math.min(255, Math.max(0, balanced));
    const stretched = ((balanced - low) / (high - low)) * 255;
    return Math.min(255, Math.max(0, stretched));
  };

  for (let i = 0; i < data.length; i += 4) {
    data[i] = stretch(data[i], gainR, lowR, highR);
    data[i + 1] = stretch(data[i + 1], gainG, lowG, highG);
    data[i + 2] = stretch(data[i + 2], gainB, lowB, highB);
    // Alpha channel (data[i + 3]) is left untouched.
  }
}

/**
 * Loads the image at `imageUrl`, applies auto-enhance, and returns the
 * result as a JPEG Blob at the given quality (default matches the rest of
 * the app's high-quality JPEG re-encodes, see repo memory on editor quality).
 */
export async function autoEnhanceImage(imageUrl: string, quality = 0.95): Promise<Blob> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not allocate canvas for auto-enhance');

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhanceImageData(imageData);
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode enhanced image'))),
      'image/jpeg',
      quality
    );
  });
}

/** Downscales a Blob to at most `maxSize` on the longest side, re-encoded as JPEG — used to build the preview alongside the enhanced original. */
export async function resizeBlobToJpeg(blob: Blob, maxSize: number, quality = 0.85): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not allocate canvas for preview resize');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode preview'))),
        'image/jpeg',
        quality
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
