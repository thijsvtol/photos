import { useState } from 'react';
import type { Photo } from '../types';

/**
 * Custom hook for managing photo selection state and operations
 */
export function usePhotoSelection(photos: Photo[]) {
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());

  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const selectAllPhotos = () => {
    const allPhotoIds = new Set(photos.map(p => p.id));
    setSelectedPhotos(allPhotoIds);
  };

  const clearSelection = () => {
    setSelectedPhotos(new Set());
  };

  const toggleDateSelection = (datePhotos: Photo[]) => {
    const datePhotoIds = new Set(datePhotos.map(p => p.id));
    const allSelected = datePhotos.every(p => selectedPhotos.has(p.id));
    
    if (allSelected) {
      // Deselect all photos from this date
      setSelectedPhotos(prev => {
        const next = new Set(prev);
        datePhotoIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all photos from this date
      setSelectedPhotos(prev => {
        const next = new Set(prev);
        datePhotos.forEach(p => next.add(p.id));
        return next;
      });
    }
  };

  const isDateFullySelected = (datePhotos: Photo[]): boolean => {
    return datePhotos.length > 0 && datePhotos.every(p => selectedPhotos.has(p.id));
  };

  return {
    selectedPhotos,
    togglePhotoSelection,
    selectAllPhotos,
    clearSelection,
    toggleDateSelection,
    isDateFullySelected,
    setSelectedPhotos, // For external use if needed
  };
}
