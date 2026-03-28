import { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegReady = false;

/**
 * Convert blob URL to fetch Data URL for FFmpeg
 */
async function toBlobURL(url: string, mimeType: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return URL.createObjectURL(new Blob([blob], { type: mimeType }));
}

/**
 * Initialize FFmpeg.wasm (lazy-loaded on first use)
 * Only downloads wasm files when this function is called
 */
export async function initFFmpeg(): Promise<FFmpeg> {
  if (ffmpegReady && ffmpegInstance) {
    return ffmpegInstance;
  }

  ffmpegInstance = new FFmpeg();

  // Set up logging for debugging
  ffmpegInstance.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);
  });

  ffmpegInstance.on('progress', ({ progress }) => {
    console.log('[FFmpeg] Progress:', Math.round(progress * 100) + '%');
  });

  try {
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegReady = true;
    console.log('[FFmpeg] Initialized successfully');
    return ffmpegInstance;
  } catch (error) {
    console.error('[FFmpeg] Failed to initialize:', error);
    ffmpegReady = false;
    ffmpegInstance = null;
    throw new Error('Failed to initialize video editor. Please ensure JavaScript is enabled.');
  }
}

/**
 * Trim/cut video to specified start and end times (in seconds)
 */
export async function trimVideo(
  videoBlob: Blob,
  startTime: number,
  endTime: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = await initFFmpeg();
  if (!ffmpegInstance?.loaded) {
    throw new Error('FFmpeg not initialized');
  }

  const inputFileName = 'input.mp4';
  const outputFileName = 'output.mp4';

  try {
    // Write input file
    const data = new Uint8Array(await videoBlob.arrayBuffer());
    ffmpeg.writeFile(inputFileName, data);

    // Clear previous progress
    ffmpegInstance?.on('progress', ({ progress }) => {
      onProgress?.(progress);
    });

    // Trim video using FFmpeg
    const duration = endTime - startTime;
    await ffmpeg.exec([
      '-i', inputFileName,
      '-ss', startTime.toFixed(2),
      '-t', duration.toFixed(2),
      '-c', 'copy', // Copy codec (fast, no re-encoding)
      '-y', // Overwrite output
      outputFileName,
    ]);

    // Read output file
    const outputData = await ffmpeg.readFile(outputFileName) as Uint8Array;
    const outputBlob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });

    // Clean up
    ffmpeg.deleteFile(inputFileName);
    ffmpeg.deleteFile(outputFileName);

    return outputBlob;
  } catch (error) {
    console.error('Trim failed:', error);
    throw new Error('Failed to trim video');
  }
}

/**
 * Crop video to specified dimensions
 * @param startX - left edge in pixels
 * @param startY - top edge in pixels
 * @param width - crop width in pixels
 * @param height - crop height in pixels
 */
export async function cropVideo(
  videoBlob: Blob,
  startX: number,
  startY: number,
  width: number,
  height: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = await initFFmpeg();
  if (!ffmpeg.loaded) {
    throw new Error('FFmpeg not initialized');
  }

  const inputFileName = 'input.mp4';
  const outputFileName = 'output.mp4';

  try {
    // Write input file
    const data = new Uint8Array(await videoBlob.arrayBuffer());
    ffmpeg.writeFile(inputFileName, data);

    ffmpegInstance?.on('progress', ({ progress }) => {
      onProgress?.(progress);
    });

    // Crop video using FFmpeg crop filter
    await ffmpeg.exec([
      '-i', inputFileName,
      '-vf', `crop=${width}:${height}:${startX}:${startY}`,
      '-c:a', 'aac', // Re-encode audio
      '-y',
      outputFileName,
    ]);

    // Read output file
    const outputData = await ffmpeg.readFile(outputFileName) as Uint8Array;
    const outputBlob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });

    // Clean up
    ffmpeg.deleteFile(inputFileName);
    ffmpeg.deleteFile(outputFileName);

    return outputBlob;
  } catch (error) {
    console.error('Crop failed:', error);
    throw new Error('Failed to crop video');
  }
}

/**
 * Rotate video 90 degrees (multiple times for 180/270)
 * @param rotations - number of 90° rotations (1=90°, 2=180°, 3=270°)
 */
export async function rotateVideo(
  videoBlob: Blob,
  rotations: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = await initFFmpeg();
  if (!ffmpeg.loaded) {
    throw new Error('FFmpeg not initialized');
  }

  if (rotations === 0 || rotations % 4 === 0) {
    return videoBlob; // No rotation needed
  }

  const inputFileName = 'input.mp4';
  const outputFileName = 'output.mp4';

  // FFmpeg rotate filter: 0=90° CW, 1=90° CCW, 2=90° CW, 3=90° CCW
  // We'll use: 1 for 90°, 2 for 180°, 3 for 270°
  const rotationMap: Record<number, string> = {
    1: 'transpose=1', // 90° CW
    2: 'transpose=2,transpose=2', // 180°
    3: 'transpose=2', // 270° (or 90° CCW)
  };

  const normalizedRotations = rotations % 4;
  const filterChain = rotationMap[normalizedRotations] || 'transpose=1';

  try {
    // Write input file
    const data = new Uint8Array(await videoBlob.arrayBuffer());
    ffmpeg.writeFile(inputFileName, data);

    ffmpegInstance?.on('progress', ({ progress }) => {
      onProgress?.(progress);
    });

    // Rotate video using FFmpeg
    await ffmpeg.exec([
      '-i', inputFileName,
      '-vf', filterChain,
      '-c:a', 'aac',
      '-y',
      outputFileName,
    ]);

    // Read output file
    const outputData = await ffmpeg.readFile(outputFileName) as Uint8Array;
    const outputBlob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });

    // Clean up
    ffmpeg.deleteFile(inputFileName);
    ffmpeg.deleteFile(outputFileName);

    return outputBlob;
  } catch (error) {
    console.error('Rotate failed:', error);
    throw new Error('Failed to rotate video');
  }
}

/**
 * Flip video horizontally or vertically
 * @param direction - 'h' for horizontal, 'v' for vertical
 */
export async function flipVideo(
  videoBlob: Blob,
  direction: 'h' | 'v',
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = await initFFmpeg();
  if (!ffmpeg.loaded) {
    throw new Error('FFmpeg not initialized');
  }

  const inputFileName = 'input.mp4';
  const outputFileName = 'output.mp4';

  const filterMap = {
    h: 'hflip', // horizontal flip
    v: 'vflip', // vertical flip
  };

  try {
    // Write input file
    const data = new Uint8Array(await videoBlob.arrayBuffer());
    ffmpeg.writeFile(inputFileName, data);

    ffmpegInstance?.on('progress', ({ progress }) => {
      onProgress?.(progress);
    });

    // Flip video using FFmpeg
    await ffmpeg.exec([
      '-i', inputFileName,
      '-vf', filterMap[direction],
      '-c:a', 'aac',
      '-y',
      outputFileName,
    ]);

    // Read output file
    const outputData = await ffmpeg.readFile(outputFileName) as Uint8Array;
    const outputBlob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });

    // Clean up
    ffmpeg.deleteFile(inputFileName);
    ffmpeg.deleteFile(outputFileName);

    return outputBlob;
  } catch (error) {
    console.error('Flip failed:', error);
    throw new Error('Failed to flip video');
  }
}

/**
 * Adjust video playback speed
 * @param speed - playback speed multiplier (0.5 = half speed, 2 = double speed)
 */
export async function adjustVideoSpeed(
  videoBlob: Blob,
  speed: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = await initFFmpeg();
  if (!ffmpeg.loaded) {
    throw new Error('FFmpeg not initialized');
  }

  if (speed === 1) {
    return videoBlob; // No speed change needed
  }

  const inputFileName = 'input.mp4';
  const outputFileName = 'output.mp4';

  try {
    // Write input file
    const data = new Uint8Array(await videoBlob.arrayBuffer());
    ffmpeg.writeFile(inputFileName, data);

    ffmpegInstance?.on('progress', ({ progress }) => {
      onProgress?.(progress);
    });

    // FFmpeg filter for video speed: setpts=PTS/speed
    // Audio speed: atempo=speed (up to 2x for audio)
    const videoFilter = `setpts=PTS/${speed}`;
    const audioFilter = speed <= 2 ? `atempo=${speed}` : `atempo=2`;

    await ffmpeg.exec([
      '-i', inputFileName,
      '-vf', videoFilter,
      '-af', audioFilter,
      '-y',
      outputFileName,
    ]);

    // Read output file
    const outputData = await ffmpeg.readFile(outputFileName) as Uint8Array;
    const outputBlob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });

    // Clean up
    ffmpeg.deleteFile(inputFileName);
    ffmpeg.deleteFile(outputFileName);

    return outputBlob;
  } catch (error) {
    console.error('Speed adjustment failed:', error);
    throw new Error('Failed to adjust video speed');
  }
}

/**
 * Apply multiple transformations at once (more efficient than separate calls)
 */
export async function applyVideoTransformations(
  videoBlob: Blob,
  options: {
    trim?: { startTime: number; endTime: number };
    crop?: { startX: number; startY: number; width: number; height: number };
    rotate?: number; // 0-3 for 0°, 90°, 180°, 270°
    speed?: number;
  },
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = await initFFmpeg();
  if (!ffmpeg.loaded) {
    throw new Error('FFmpeg not initialized');
  }

  const inputFileName = 'input.mp4';
  const outputFileName = 'output.mp4';

  try {
    // Write input file
    const data = new Uint8Array(await videoBlob.arrayBuffer());
    ffmpeg.writeFile(inputFileName, data);

    ffmpegInstance?.on('progress', ({ progress }) => {
      onProgress?.(progress);
    });

    // Build FFmpeg command with all transformations
    const cmd: string[] = ['-i', inputFileName];

    // Add trim parameters if provided
    if (options.trim) {
      cmd.push('-ss', options.trim.startTime.toFixed(2));
      cmd.push('-t', (options.trim.endTime - options.trim.startTime).toFixed(2));
    }

    // Build video filter chain
    const videoFilters: string[] = [];

    // Add crop filter
    if (options.crop) {
      videoFilters.push(
        `crop=${options.crop.width}:${options.crop.height}:${options.crop.startX}:${options.crop.startY}`
      );
    }

    // Add rotate filter
    if (options.rotate && options.rotate > 0) {
      const rotationMap: Record<number, string> = {
        1: 'transpose=1',
        2: 'transpose=2,transpose=2',
        3: 'transpose=2',
      };
      const normalizedRotations = options.rotate % 4;
      if (normalizedRotations > 0) {
        videoFilters.push(rotationMap[normalizedRotations]);
      }
    }

    // Add filters to command
    if (videoFilters.length > 0) {
      cmd.push('-vf', videoFilters.join(','));
    }

    // Add speed filters
    if (options.speed && options.speed !== 1) {
      cmd.push('-vf', `setpts=PTS/${options.speed}`);
      if (options.speed <= 2) {
        cmd.push('-af', `atempo=${options.speed}`);
      }
    }

    cmd.push('-c:a', 'aac');
    cmd.push('-y', outputFileName);

    // Execute FFmpeg
    await ffmpeg.exec(cmd);

    // Read output file
    const outputData = await ffmpeg.readFile(outputFileName) as Uint8Array;
    const outputBlob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });

    // Clean up
    ffmpeg.deleteFile(inputFileName);
    ffmpeg.deleteFile(outputFileName);

    return outputBlob;
  } catch (error) {
    console.error('Video transformation failed:', error);
    throw new Error('Failed to apply video transformations');
  }
}

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(videoBlob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(videoBlob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video metadata'));
    };
    video.src = url;
  });
}

/**
 * Cleanup: unload FFmpeg from memory
 * Call this when user navigates away from video editor
 */
export async function unloadFFmpeg(): Promise<void> {
  if (ffmpegInstance && ffmpegReady) {
    try {
      await ffmpegInstance.terminate();
      ffmpegInstance = null;
      ffmpegReady = false;
      console.log('[FFmpeg] Unloaded from memory');
    } catch (error) {
      console.error('[FFmpeg] Failed to unload:', error);
    }
  }
}

/**
 * Check if FFmpeg is ready for use
 */
export function isFFmpegReady(): boolean {
  return ffmpegReady && ffmpegInstance !== null && ffmpegInstance.loaded;
}
