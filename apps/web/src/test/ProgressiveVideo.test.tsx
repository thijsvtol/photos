import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ProgressiveVideo from '../components/ProgressiveVideo';

/**
 * The whole point of the poster-image path: a video tile must NOT mount a <video> (i.e. must not
 * fetch any MP4 bytes) while it's just sitting in a scrolling grid. It shows the poster image at
 * rest and only mounts the <video> when the user hovers to preview.
 */
describe('ProgressiveVideo with a poster image', () => {
  beforeEach(() => {
    // Report hover support so the hover-to-mount path is active (setup.ts's default
    // matchMedia mock returns matches:false, which would disable it).
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('renders no <video> at rest (no MP4 fetched while scrolling)', () => {
    const { container } = render(
      <ProgressiveVideo
        src="/media/ev1/preview/vid1.mp4"
        poster="data:image/jpeg;base64,blur"
        posterUrl="/media/ev1/poster/vid1.jpg"
      />
    );
    expect(container.querySelector('video')).toBeNull();
  });

  it('mounts the <video> at the MP4 src on hover', () => {
    const { container } = render(
      <ProgressiveVideo
        src="/media/ev1/preview/vid1.mp4"
        poster="data:image/jpeg;base64,blur"
        posterUrl="/media/ev1/poster/vid1.jpg"
      />
    );
    const tile = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(tile);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('/media/ev1/preview/vid1.mp4');
    // Unmounts again on mouse leave, releasing the video.
    fireEvent.mouseLeave(tile);
    expect(container.querySelector('video')).toBeNull();
  });

  it('drops the poster <img> when it fails to load (e.g. not-yet-backfilled video 404)', () => {
    const { container } = render(
      <ProgressiveVideo
        src="/media/ev1/preview/vid1.mp4"
        poster="data:image/jpeg;base64,blur"
        posterUrl="/media/ev1/poster/vid1.jpg"
      />
    );
    const posterImg = container.querySelector('img[src="/media/ev1/poster/vid1.jpg"]') as HTMLImageElement;
    expect(posterImg).not.toBeNull();
    // Simulate the 404: onError flips the tile off the poster path (falls back to the legacy
    // near-viewport <video> mount) instead of leaving a broken image.
    fireEvent.error(posterImg);
    expect(container.querySelector('img[src="/media/ev1/poster/vid1.jpg"]')).toBeNull();
  });
});
