import React from 'react';
import ProgressiveImage from './ProgressiveImage';
import ProgressiveVideo from './ProgressiveVideo';
import { getPreviewUrl, getVideoPosterUrl } from '../api';

interface MediaThumbProps {
  /** Event slug the media belongs to (used to build the preview URL). */
  slug: string;
  photoId: string;
  /** MIME type; `'video/mp4'` selects the video renderer. May be null/undefined for legacy rows. */
  fileType?: string | null;
  cacheVersion?: number | null;
  /** Base64 blur data URL — used as the image placeholder / video poster when available. */
  blurPlaceholder?: string | null;
  alt?: string;
  /** Applied to the inner <img>/<video>; callers keep passing the same object-cover classes. */
  className?: string;
}

/**
 * A single media tile that renders a still-image preview for photos and a real inline video
 * preview (poster/first-frame still + play badge, hover-to-play) for videos — the exact same
 * `file_type === 'video/mp4'` branch the main gallery uses in JustifiedGrid/PhotoCard, factored
 * out so the admin People / Unattached-photos views don't each re-point an <img> at a `.mp4`
 * URL (which can't decode, so videos previously showed as broken thumbnails there). See
 * getPreviewUrl() in api.ts for why a video's preview URL is the `.mp4` itself, not a poster JPEG.
 */
const MediaThumb: React.FC<MediaThumbProps> = ({
  slug,
  photoId,
  fileType,
  cacheVersion,
  blurPlaceholder,
  alt = '',
  className = 'w-full h-full object-cover',
}) => {
  const src = getPreviewUrl(slug, photoId, fileType ?? undefined, cacheVersion ?? undefined);
  if (fileType === 'video/mp4') {
    return (
      <ProgressiveVideo
        src={src}
        poster={blurPlaceholder ?? undefined}
        posterUrl={getVideoPosterUrl(slug, photoId, cacheVersion ?? undefined)}
        className={className}
      />
    );
  }
  return (
    <ProgressiveImage
      src={src}
      blurDataUrl={blurPlaceholder ?? undefined}
      alt={alt}
      className={className}
      loading="lazy"
    />
  );
};

export default MediaThumb;
