import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { Photo } from '../types';

type PhotoListSetter = React.Dispatch<React.SetStateAction<Photo[]>>;

interface PhotoNavigationContextValue {
  /** The current on-screen-ordered photo list of whichever gallery page (EventGallery/Timeline/
   *  MyFavorites) is presently mounted "underneath" the PhotoDetail overlay — see App.tsx's
   *  background-location routing. PhotoDetail reads this directly for next/prev navigation and
   *  the "N / total" counter, instead of being handed a separate id/slug list via router state
   *  (the previous approach, which needed a bespoke ordered list per page and silently broke
   *  cross-event swiping whenever a new entry point was added). Every item must carry its own
   *  `event_slug` since Timeline/Favorites lists span multiple events. Empty when no gallery
   *  page has registered a list (e.g. a cold/direct load of a shared /p/:slug/:photoId link) —
   *  PhotoDetail falls back to self-fetching that one event's gallery in that case. */
  photos: Photo[];
  /**
   * Called by a gallery page whenever its own on-screen photo list changes (load/filter/sort/
   * page). `setter` is that page's OWN React state setter for its underlying (pre-filter) photo
   * array — removePhoto()/updatePhoto() forward through it so a mutation made from inside the
   * PhotoDetail overlay (delete, feature-toggle) patches the SAME page's real state directly,
   * and it's still showing the up-to-date result once the overlay closes (that page never
   * unmounts/re-fetches on its own under the overlay routing). Pass `setter: null` on unmount to
   * avoid holding a stale reference once the page goes away for real.
   */
  registerPhotoList: (photos: Photo[], setter: PhotoListSetter | null) => void;
  removePhoto: (photoId: string) => void;
  updatePhoto: (photoId: string, patch: Partial<Photo>) => void;
  /**
   * The id of whichever photo the PhotoDetail overlay is CURRENTLY showing (updated on every
   * swipe, not just once), or `null` when no overlay is open. A gallery page watches this
   * (comparing against its own previous value in a ref) to detect the exact moment its overlay
   * closes and scroll back to whatever photo the user actually ended up on — this lives here,
   * as a plain value change a still-mounted page reacts to, rather than as a DOM scroll
   * triggered from inside PhotoDetail's own unmount cleanup, because the gallery page's effect
   * is guaranteed to run in a completely normal render (with PhotoDetail already fully removed
   * by then), with none of the DOM/commit-timing uncertainty of scrolling during the overlay's
   * own teardown.
   */
  activePhotoId: string | null;
  setActivePhotoId: (photoId: string | null) => void;
}

const PhotoNavigationContext = createContext<PhotoNavigationContextValue | undefined>(undefined);

export const PhotoNavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const setterRef = useRef<PhotoListSetter | null>(null);

  const registerPhotoList = useCallback((next: Photo[], setter: PhotoListSetter | null) => {
    setPhotos(next);
    setterRef.current = setter;
  }, []);

  const removePhoto = useCallback((photoId: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setterRef.current?.((prev) => prev.filter((p) => p.id !== photoId));
  }, []);

  const updatePhoto = useCallback((photoId: string, patch: Partial<Photo>) => {
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, ...patch } : p)));
    setterRef.current?.((prev) => prev.map((p) => (p.id === photoId ? { ...p, ...patch } : p)));
  }, []);

  return (
    <PhotoNavigationContext.Provider
      value={{ photos, registerPhotoList, removePhoto, updatePhoto, activePhotoId, setActivePhotoId }}
    >
      {children}
    </PhotoNavigationContext.Provider>
  );
};

export const usePhotoNavigation = (): PhotoNavigationContextValue => {
  const context = useContext(PhotoNavigationContext);
  if (context === undefined) {
    throw new Error('usePhotoNavigation must be used within a PhotoNavigationProvider');
  }
  return context;
};
