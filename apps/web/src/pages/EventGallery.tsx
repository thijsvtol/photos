import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Upload, Settings, Users, X, Check, UserX } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { GallerySkeleton } from '../components/Skeletons';
import VerticalDateScrubber from '../components/VerticalDateScrubber';
import JustifiedGrid from '../components/JustifiedGrid';
import { useGridDensity } from '../hooks/useGridDensity';
import SEO from '../components/SEO';
import UploadPanel from '../components/UploadPanel';
import EventFormModal from '../components/EventFormModal';
import { useRefresh } from '../contexts/RefreshContext';
import { EventPasswordForm } from '../components/EventPasswordForm';
import { GallerySortFilter } from '../components/GallerySortFilter';
import { ShareEventButton } from '../components/ShareEventButton';
import CastButton from '../components/CastButton';
import AlbumPicker from '../components/AlbumPicker';
import EventLocationPicker from '../components/EventLocationPicker';
import { useUpload } from '../hooks/useUpload';
import { getEvent, getPhotos, loginToEvent, getPreviewUrl, getCastPreviewUrl, requestZip, downloadZip, setPhotoFeatured, getUserFavoriteIds, toggleFavorite as toggleFavoriteAPI, bulkDeletePhotos, bulkCopyPhotos, bulkUpdatePhotoLocation, bulkTagPeopleOnPhotos, bulkUntagPeopleOnPhotos, getCollaborators, getNamedPeople, getPublicNamedPeople } from '../api';
import type { NamedPerson, PublicNamedPerson } from '../api';
import type { Event, Photo, Collaborator } from '../types';
import { getCachedEventPhotos, cacheEventPhotos } from '../services/eventPhotoCache';
import { CollaboratorAvatars } from '../components/CollaboratorAvatars';
import { useAuth } from '../contexts/AuthContext';
import { usePhotoNavigation } from '../contexts/PhotoNavigationContext';
import { usePhotoSelection } from '../hooks/usePhotoSelection';
import { config } from '../config';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { haptics } from '../utils/haptics';
import { trackPhotoDownload, trackFavorite } from '../services/analytics';

const EventGallery: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { isAuthenticated, login, user } = useAuth();
  const { registerRefreshHandler, unregisterRefreshHandler } = useRefresh();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const isAdmin = user?.isAdmin === true;
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('date_desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'photos' | 'videos'>('all');
  // People filter — available to EVERY viewer (not just admins), same as the Timeline/Search
  // people filter. Requires ALL selected people to be in a photo (AND semantics — see the worker
  // route's doc comment for why that's the right default for multi-select; the public
  // GET /events/:slug/photos endpoint already supports the `people` param). Admins filter using
  // the full admin people list (`namedPeople`, also used by the "Tag people" bulk action);
  // non-admins use the public first-name-only list (`filterPeople`, from GET /api/people/named,
  // which is privacy-restricted server-side to people appearing in accessible events). The filter
  // UI (searchable picker) lives inside GallerySortFilter (see its
  // namedPeople/selectedPersonIds/onTogglePerson props).
  const [peopleFilterIds, setPeopleFilterIds] = useState<Set<number>>(new Set());
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showPeopleTagPicker, setShowPeopleTagPicker] = useState(false);
  const [namedPeople, setNamedPeople] = useState<NamedPerson[]>([]);
  const [namedPeopleLoading, setNamedPeopleLoading] = useState(false);
  // Public (first-name-only) people list used to power the people filter for NON-admin viewers.
  const [filterPeople, setFilterPeople] = useState<PublicNamedPerson[]>([]);
  const [peopleTagSelection, setPeopleTagSelection] = useState<Set<number>>(new Set());
  const [peopleTagSearchQuery, setPeopleTagSearchQuery] = useState('');
  const [taggingPeople, setTaggingPeople] = useState(false);
  const [collaboratorRole, setCollaboratorRole] = useState<'viewer' | 'uploader' | 'editor' | 'admin' | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const dateRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [isMobile, setIsMobile] = useState(false);
  const [supportsHover, setSupportsHover] = useState(true);
  const { targetRowHeight, containerRef: densityContainerRef, density, changeDensity } = useGridDensity();
  const [visibleDateCount, setVisibleDateCount] = useState(8);
  const [visibleSinglePhotoCount, setVisibleSinglePhotoCount] = useState(140);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef(0);
  const prefetchedPhotoIdsRef = useRef<Set<string>>(new Set());
  /** Where to scroll back to after returning from PhotoDetail, held for the whole
   *  restore rather than read-and-consumed from sessionStorage — see the restore
   *  effect for why (the photo list arrives twice: cache, then network). Null when
   *  no restore is pending. */
  const restoreTargetRef = useRef<{ scrollY: number; photoId: string | null } | null>(null);
  const canUpload = isAdmin || collaboratorRole === 'uploader' || collaboratorRole === 'editor' || collaboratorRole === 'admin';
  const canDelete = isAdmin || collaboratorRole === 'editor' || collaboratorRole === 'admin';
  const canCreateInvite = isAdmin || collaboratorRole === 'editor' || collaboratorRole === 'admin';
  const canFeature = isAdmin || collaboratorRole === 'admin';
  const [showEventSettings, setShowEventSettings] = useState(false);
  const [duplicateBannerDismissed, setDuplicateBannerDismissed] = useState(false);
  const [removingDuplicates, setRemovingDuplicates] = useState(false);

  // Group photos by content hash (file_hash) to detect duplicate uploads.
  // Photos uploaded before the file_hash column existed have it as null/undefined
  // and are simply excluded from detection (no retroactive backfill).
  const duplicateGroups = useMemo(() => {
    const byHash = new Map<string, Photo[]>();
    for (const photo of photos) {
      if (!photo.file_hash) continue;
      const group = byHash.get(photo.file_hash);
      if (group) group.push(photo);
      else byHash.set(photo.file_hash, [photo]);
    }
    return Array.from(byHash.values()).filter((group) => group.length > 1);
  }, [photos]);
  const duplicatePhotoCount = duplicateGroups.reduce((sum, group) => sum + group.length - 1, 0);

  // Upload hook for drag-drop
  const { handleDragOver, handleDragLeave, handleDrop, handleFileInput, queueItems } = useUpload(slug);

  // Use custom hook for photo selection
  const {
    selectedPhotos,
    togglePhotoSelection: togglePhotoSelectionBase,
    clearSelection,
    toggleDateSelection,
    isDateFullySelected,
  } = usePhotoSelection(photos);

  // Wrapper to add haptic feedback to photo selection
  const togglePhotoSelection = async (photoId: string) => {
    await haptics.selectionChanged();
    togglePhotoSelectionBase(photoId);
  };

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640); // sm breakpoint
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Detect whether hover interactions are available.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const updateSupportsHover = () => setSupportsHover(mediaQuery.matches);

    updateSupportsHover();
    mediaQuery.addEventListener('change', updateSupportsHover);
    return () => mediaQuery.removeEventListener('change', updateSupportsHover);
  }, []);

  // One-time discoverability hint for touch devices.
  useEffect(() => {
    if (loading || photos.length === 0 || supportsHover) {
      return;
    }

    const hintKey = 'gallery_long_press_hint_seen_v1';
    if (localStorage.getItem(hintKey)) {
      return;
    }

    toast.showInfo('Tip: Long-press a photo to start multi-select.');
    localStorage.setItem(hintKey, '1');
  }, [loading, photos.length, supportsHover, toast]);

  useEffect(() => {
    if (slug) {
      loadEvent();
    }
    setDuplicateBannerDismissed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Register refresh handler
  useEffect(() => {
    if (authenticated) {
      registerRefreshHandler(handleRefresh);
      return () => unregisterRefreshHandler();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  useEffect(() => {
    // Load user favorites and check collaborator status if authenticated
    const loadUserData = async () => {
      if (isAuthenticated && slug) {
        try {
          const [favorites] = await Promise.all([
            getUserFavoriteIds(),
          ]);
          const favoriteIds = new Set(favorites.map(f => f.photoId));
          setUserFavorites(favoriteIds);
        } catch (err) {
          console.error('Failed to load user data:', err);
        }
      } else {
        setUserFavorites(new Set());
        setCollaboratorRole(null);
      }
    };
    loadUserData();
  }, [isAuthenticated, slug]);

  // Load collaborators for invite-only events
  useEffect(() => {
    const loadCollaborators = async () => {
      if (event && event.visibility === 'collaborators_only' && slug) {
        try {
          const collabData = await getCollaborators(slug);
          setCollaborators(collabData);
        } catch (err) {
          console.error('Failed to load collaborators:', err);
          // Silently fail - collaborators display is optional
        }
      } else {
        setCollaborators([]);
      }
    };
    loadCollaborators();
  }, [event, slug]);

  useEffect(() => {
    if (!user?.email) {
      setCollaboratorRole(null);
      return;
    }

    const currentUserEmail = user.email.toLowerCase();
    const mine = collaborators.find((c) => {
      const candidateEmails = [c.user_email, c.email].filter((value): value is string => typeof value === 'string');
      return candidateEmails.some((email) => email.toLowerCase() === currentUserEmail);
    });
    setCollaboratorRole((mine?.role as 'viewer' | 'uploader' | 'editor' | 'admin' | undefined) || null);
  }, [collaborators, user?.email]);

  // Disable browser's built-in scroll restoration so our custom logic handles it
  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);

  // Restore scroll position when returning to gallery
  // (moved to after visibleDateCount/visibleSinglePhotoCount expansion below)

  const loadEvent = async () => {
    try {
      setLoading(true);

      // Paint from the IndexedDB cache before the network is consulted at all.
      // Without this, opening a large event showed nothing until a full round-trip
      // completed — every single time. The fetch below still runs and reconciles;
      // this only removes the wait before the first photo appears.
      //
      // Deliberately not gated on `authenticated`: a cache entry can only exist if
      // this browser previously loaded the event successfully, which required
      // access then. The real access check still happens server-side on the fetch,
      // and logout wipes the cache (see AuthContext).
      if (isUnfilteredListing) {
        try {
          const cached = await getCachedEventPhotos(slug!);
          if (cached.length > 0) {
            setPhotos(cached);
            setLoading(false);
          }
        } catch (err) {
          console.error('Failed to read event photo cache:', err);
        }
      }

      const eventData = await getEvent(slug!);
      setEvent(eventData);

      // If event doesn't require password, load photos immediately
      if (!eventData.requires_password) {
        try {
          const photoData = await getPhotos(slug!, sortBy, Array.from(peopleFilterIds));
          setPhotos(photoData);
          if (isUnfilteredListing) void cacheEventPhotos(slug!, photoData);
          setAuthenticated(true);
        } catch (err) {
          console.error('Failed to load photos for public event:', err);
        }
      } else {
        // Try to load photos (will succeed if already authenticated)
        try {
          const photoData = await getPhotos(slug!, sortBy, Array.from(peopleFilterIds));
          setPhotos(photoData);
          if (isUnfilteredListing) void cacheEventPhotos(slug!, photoData);
          setAuthenticated(true);
        } catch {
          // Not authenticated yet. Drop anything painted from cache — the session
          // that could see these photos has ended.
          setPhotos([]);
          setAuthenticated(false);
        }
      }

      setError(null);
    } catch (err) {
      setError('Failed to load event');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (password: string) => {
    await loginToEvent(slug!, password);
    setAuthenticated(true);
    await loadPhotos();
  };

  /**
   * True only for an unfiltered listing, i.e. the complete set of photos for this
   * event.
   *
   * cacheEventPhotos() deletes any cached row the response doesn't contain, so
   * handing it a people-filtered subset would wipe every other photo from the
   * cache. Reading is gated the same way: showing a cached full set while a
   * filter is active would render photos the filter excludes.
   */
  const isUnfilteredListing = peopleFilterIds.size === 0;

  const loadPhotos = async () => {
    try {
      const photoData = await getPhotos(slug!, sortBy, Array.from(peopleFilterIds));
      setPhotos(photoData);
      if (isUnfilteredListing) void cacheEventPhotos(slug!, photoData);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRefresh = async () => {
    if (authenticated) {
      await Promise.all([loadEvent(), loadPhotos()]);
    }
  };

  // Auto-refresh the gallery as soon as any upload for this event finishes,
  // instead of only refetching once the *entire* batch is done. This fixes
  // two related bugs:
  //  - Videos (and photos) not appearing until a manual page refresh: the
  //    previous approach only refetched on a "some active -> none active"
  //    edge detected inside <UploadPanel>, which is missed entirely if this
  //    component (re)mounts after uploads already completed (e.g. the user
  //    navigated away mid-upload and came back, or uploads finished via the
  //    native background-sync pipeline while this page wasn't mounted).
  //  - A slow item in a mixed batch (e.g. a large video) delaying the
  //    appearance of already-finished photos, since the old logic only
  //    fired once every item was done.
  // Comparing against a ref (not state) means every *newly seen* completed
  // item — including ones already completed at mount — triggers exactly one
  // refetch, so the gallery is always eventually consistent with the queue.
  const seenCompletedUploadIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!authenticated) return;
    const completedIds = queueItems
      .filter((item) => item.status === 'completed')
      .map((item) => item.id);
    const hasNewlyCompleted = completedIds.some(
      (id) => !seenCompletedUploadIdsRef.current.has(id)
    );
    // Rebuild the tracked set from the current queue on every run (instead
    // of only adding to it) so it can't grow unbounded across a long-lived
    // session — items the manager has since purged (e.g. via
    // clearCompleted()) are dropped rather than retained forever.
    seenCompletedUploadIdsRef.current = new Set(completedIds);
    if (hasNewlyCompleted) {
      loadPhotos();
    }
    // `loadPhotos` intentionally omitted: it's a plain (non-memoized) async
    // function redefined every render, and it doesn't need to be in the
    // dependency array — this effect should only re-run when the upload
    // queue or auth state changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueItems, authenticated]);

  // Reload photos when sort or people filter changes
  useEffect(() => {
    if (authenticated && slug) {
      loadPhotos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, peopleFilterIds]);

  // Eagerly load the full admin named-people list for admins — this backs the multi-select
  // "Tag people" bulk action (which can tag someone not yet in this event), NOT the filter.
  useEffect(() => {
    if (!isAdmin) return;
    getNamedPeople().then(setNamedPeople).catch((err) => console.error('Failed to load people list', err));
  }, [isAdmin]);

  // People FILTER list — scoped via ?event=<slug> to people who actually appear in THIS event,
  // so you can't pick someone who isn't in it and get zero results. Loaded for every viewer
  // (admins included); access to the event is enforced server-side on the endpoint.
  useEffect(() => {
    if (!slug) return;
    getPublicNamedPeople(slug).then(setFilterPeople).catch((err) => console.error('Failed to load people list', err));
  }, [slug]);

  // The gallery's people filter is event-scoped for everyone; the admin-only `namedPeople` list
  // above backs the separate "Tag people" bulk action, not this filter.
  const galleryFilterPeople = filterPeople;

  const toggleFavorite = async (photoId: string, isFavorited: boolean) => {
    // Require authentication for favorites
    if (!isAuthenticated) {
      const shouldLogin = await confirm(
        'Login Required',
        'You need to be logged in to save favorites. Would you like to login now?'
      );
      if (shouldLogin) {
        login();
      }
      return;
    }
    
    try {
      await toggleFavoriteAPI(photoId, isFavorited);
      
      // Haptic feedback
      await haptics.light();
      
      // Track favorite action
      trackFavorite(photoId, isFavorited ? 'remove' : 'add');
      
      // Update local state
      const newFavorites = new Set(userFavorites);
      if (isFavorited) {
        newFavorites.delete(photoId);
      } else {
        newFavorites.add(photoId);
      }
      setUserFavorites(newFavorites);
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      toast.showError('Failed to update favorite. Please try again.');
    }
  };

  const toggleFeatured = async (photoId: string, currentStatus: boolean) => {
    try {
      await setPhotoFeatured(photoId, !currentStatus);
      // Update local state
      setPhotos(photos.map(p => 
        p.id === photoId ? { ...p, is_featured: !currentStatus } : p
      ));
    } catch (err) {
      console.error('Failed to toggle featured status:', err);
      toast.showError('Failed to update featured status. You may need admin access.');
    }
  };

  const downloadSelected = async () => {
    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      toast.showInfo('No photos selected');
      return;
    }
    
    if (selected.length > 50) {
      toast.showInfo('Maximum 50 photos can be downloaded at once');
      return;
    }
    
    await haptics.light();
    
    try {
      // Request ZIP file from server
      const zipBlob = await requestZip(slug!, selected);
      
      // Download using platform-specific method
      const timestamp = new Date().toISOString().split('T')[0];
      await downloadZip(zipBlob, `${slug}_${timestamp}.zip`);
      
      // Track bulk download
      trackPhotoDownload('bulk', slug!, true, selected.length);
    } catch (error) {
      console.error('Error downloading ZIP:', error);
      toast.showError('Failed to download ZIP file');
    }
  };

  const handleBulkDelete = async () => {
    if (!canDelete) {
      toast.showError('Delete permission required for this event.');
      return;
    }

    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      toast.showInfo('No photos selected');
      return;
    }
    
    const confirmed = await confirm(
      'Delete Photos',
      `Are you sure you want to delete ${selected.length} selected photo(s)? This cannot be undone!`,
      { variant: 'danger' }
    );
    
    if (!confirmed) return;
    
    try {
      setDeleting(true);
      
      // Use bulk delete API
      const result = await bulkDeletePhotos(selected);
      
      // Reload photos
      await loadPhotos();
      clearSelection();
      
      if (result.deletedCount === result.totalRequested) {
        await haptics.success();
        toast.showSuccess(`Successfully deleted ${result.deletedCount} photo(s)`);
      } else {
        await haptics.warning();
        toast.showInfo(`Deleted ${result.deletedCount} of ${result.totalRequested} photo(s). Some photos may have failed to delete.`);
      }
    } catch (error) {
      console.error('Error deleting photos:', error);
      await haptics.error();
      toast.showError('Failed to delete photos. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  // Sets/overrides the GPS location for the currently selected photos.
  // Admin-only (enforced both here and server-side — see /admin/photos/bulk-location).
  const handleBulkSetLocation = async (latitude: number, longitude: number) => {
    if (!isAdmin) {
      toast.showError('Admin access required to edit photo location');
      return;
    }

    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      toast.showInfo('No photos selected');
      return;
    }

    try {
      const result = await bulkUpdatePhotoLocation(selected, latitude, longitude);
      setPhotos((prev) =>
        prev.map((photo) =>
          selectedPhotos.has(photo.id) ? { ...photo, latitude, longitude } : photo
        )
      );
      setShowLocationPicker(false);
      clearSelection();
      await haptics.success();
      toast.showSuccess(`Updated location for ${result.updatedCount} photo(s)`);
    } catch (error) {
      console.error('Error updating photo location:', error);
      await haptics.error();
      toast.showError('Failed to update photo location. Please try again.');
    }
  };

  const handleToggleGalleryPersonFilter = (personId: number) => {
    setPeopleFilterIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  };

  const handleOpenPeopleTagPicker = async () => {
    if (selectedPhotos.size === 0) {
      toast.showInfo('No photos selected');
      return;
    }
    setPeopleTagSelection(new Set());
    setPeopleTagSearchQuery('');
    setShowPeopleTagPicker(true);
    setNamedPeopleLoading(true);
    try {
      const people = await getNamedPeople();
      setNamedPeople(people);
    } catch (err) {
      console.error('Failed to load people list', err);
      toast.showError('Failed to load people list');
    } finally {
      setNamedPeopleLoading(false);
    }
  };

  const handleToggleTagPersonSelection = (personId: number) => {
    setPeopleTagSelection((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  };

  // Adds (never replaces/removes) the selected people to every currently-selected photo — see
  // bulkTagPeopleOnPhotos()'s doc comment in api.ts for why this is deliberately additive.
  const handleBulkTagPeople = async () => {
    if (peopleTagSelection.size === 0) {
      toast.showInfo('Select at least one person');
      return;
    }
    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      toast.showInfo('No photos selected');
      return;
    }

    setTaggingPeople(true);
    try {
      const result = await bulkTagPeopleOnPhotos(selected, Array.from(peopleTagSelection));
      setShowPeopleTagPicker(false);
      clearSelection();
      await haptics.success();
      toast.showSuccess(`Tagged people on ${result.taggedPhotoCount} photo(s)`);
    } catch (err) {
      console.error('Failed to bulk-tag people', err);
      await haptics.error();
      toast.showError('Failed to tag people. Please try again.');
    } finally {
      setTaggingPeople(false);
    }
  };

  // Removes EVERY person from every selected photo — the "Person: none" bulk action, the inverse
  // of handleBulkTagPeople above (which only ever adds).
  const handleBulkUntagPeople = async () => {
    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      toast.showInfo('No photos selected');
      return;
    }
    const confirmed = await confirm(
      'Remove All People',
      `Remove every tagged person from ${selected.length} photo${selected.length === 1 ? '' : 's'}? This cannot be undone automatically.`,
      { variant: 'danger' }
    );
    if (!confirmed) return;

    setTaggingPeople(true);
    try {
      const result = await bulkUntagPeopleOnPhotos(selected);
      setShowPeopleTagPicker(false);
      clearSelection();
      await haptics.success();
      toast.showSuccess(`Removed people from ${result.clearedCount} photo(s)`);
    } catch (err) {
      console.error('Failed to bulk-untag people', err);
      await haptics.error();
      toast.showError('Failed to remove people. Please try again.');
    } finally {
      setTaggingPeople(false);
    }
  };

  const handleRemoveDuplicates = async () => {
    if (duplicateGroups.length === 0) return;

    const confirmed = await confirm(
      'Remove Duplicate Photos',
      `Found ${duplicateGroups.length} set(s) of duplicate photos (${duplicatePhotoCount} extra cop${duplicatePhotoCount === 1 ? 'y' : 'ies'}). The first photo in each set will be kept and the rest deleted. This cannot be undone!`,
      { variant: 'danger' }
    );
    if (!confirmed) return;

    // Keep the first (e.g. earliest-uploaded) photo in each duplicate group,
    // delete the rest.
    const idsToDelete = duplicateGroups.flatMap((group) => group.slice(1).map((p) => p.id));

    try {
      setRemovingDuplicates(true);
      const result = await bulkDeletePhotos(idsToDelete);
      await loadPhotos();
      await haptics.success();
      toast.showSuccess(`Removed ${result.deletedCount} duplicate photo(s)`);
      setDuplicateBannerDismissed(true);
    } catch (error) {
      console.error('Error removing duplicate photos:', error);
      await haptics.error();
      toast.showError('Failed to remove duplicate photos. Please try again.');
    } finally {
      setRemovingDuplicates(false);
    }
  };

  const handleBulkCopy = async (targetEventSlug: string) => {
    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      toast.showInfo('No photos selected');
      return;
    }

    try {
      setCopying(true);
      const result = await bulkCopyPhotos(selected, targetEventSlug);

      clearSelection();

      if (result.copiedCount === result.totalRequested) {
        await haptics.success();
        toast.showSuccess(`Successfully copied ${result.copiedCount} photo(s) to the album`);
      } else {
        await haptics.warning();
        toast.showInfo(`Copied ${result.copiedCount} of ${result.totalRequested} photo(s). Some photos may have failed to copy.`);
      }
    } catch (error) {
      console.error('Error copying photos:', error);
      await haptics.error();
      toast.showError('Failed to copy photos. Please try again.');
    } finally {
      setCopying(false);
    }
  };

  // Group photos by date
  const groupPhotosByDate = (photos: Photo[]) => {
    const groups = new Map<string, Photo[]>();
    
    photos.forEach(photo => {
      // Extract date from capture_time (YYYY-MM-DD)
      const date = photo.capture_time.split('T')[0];
      if (!groups.has(date)) {
        groups.set(date, []);
      }
      groups.get(date)!.push(photo);
    });
    
    // Sort dates in descending order (newest first) or ascending based on sortBy
    const sortedDates = Array.from(groups.keys()).sort((a, b) => {
      if (sortBy.startsWith('date_desc')) {
        return b.localeCompare(a);
      } else {
        return a.localeCompare(b);
      }
    });
    
    return { groups, dates: sortedDates };
  };

  const handleDateClick = (date: string) => {
    const element = dateRefs.current.get(date);
    if (element) {
      const offset = 100; // Offset for sticky timeline
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    } else {
      // Date section not yet rendered — expand visible dates to include it, then scroll
      const dateIndex = dates.indexOf(date);
      if (dateIndex >= 0) {
        setVisibleDateCount(dateIndex + 1);
        // Wait for render, then scroll
        requestAnimationFrame(() => {
          setTimeout(() => {
            const el = dateRefs.current.get(date);
            if (el) {
              const offset = 100;
              const elementPosition = el.getBoundingClientRect().top;
              const offsetPosition = elementPosition + window.pageYOffset - offset;
              window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
            }
          }, 50);
        });
      }
    }
  };

  // Set up intersection observer to track active date section
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const date = entry.target.getAttribute('data-date');
            if (date) {
              setActiveDate(date);
            }
          }
        });
      },
      {
        rootMargin: '-100px 0px -60% 0px', // Trigger when section is near top
        threshold: 0.1
      }
    );

    // Observe all date sections
    dateRefs.current.forEach((element) => {
      observer.observe(element);
    });

    return () => {
      observer.disconnect();
    };
  }, [photos]);

  // Filter photos by media type (all/photos/videos)
  const mediaTypeFilteredPhotos = mediaTypeFilter === 'all'
    ? photos
    : photos.filter((photo) => (
        mediaTypeFilter === 'videos'
          ? photo.file_type === 'video/mp4'
          : photo.file_type !== 'video/mp4'
      ));

  // Filter photos by search query
  const filteredPhotos = searchQuery.trim()
    ? mediaTypeFilteredPhotos.filter((photo) => {
        const query = searchQuery.toLowerCase();
        return (
          photo.original_filename.toLowerCase().includes(query) ||
          (photo.camera_make && photo.camera_make.toLowerCase().includes(query)) ||
          (photo.camera_model && photo.camera_model.toLowerCase().includes(query)) ||
          (photo.lens_model && photo.lens_model.toLowerCase().includes(query)) ||
          (photo.city && photo.city.toLowerCase().includes(query)) ||
          (photo.capture_time && photo.capture_time.toLowerCase().includes(query))
        );
      })
    : mediaTypeFilteredPhotos;

  const { groups: photosByDate, dates } = groupPhotosByDate(filteredPhotos);

  // Lets PhotoDetail (rendered as an overlay on top of this page — see App.tsx's background-
  // location routing) navigate next/prev through EXACTLY what's currently visible here
  // (respecting mediaTypeFilter/searchQuery), and patch `photos` directly for a delete/feature-
  // toggle made from inside the overlay, instead of re-fetching once it closes. `event_slug` is
  // guaranteed here (this event's own photos don't always carry it themselves) since
  // PhotoNavigationContext's list must always know which event each photo belongs to.
  const { registerPhotoList } = usePhotoNavigation();
  useEffect(() => {
    registerPhotoList(
      filteredPhotos.map((p) => ({ ...p, event_slug: p.event_slug || slug })),
      setPhotos
    );
  }, [filteredPhotos, slug, registerPhotoList]);
  useEffect(() => () => registerPhotoList([], null), [registerPhotoList]);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event?.name || '',
    url: `${window.location.origin}/events/${slug}`,
    startDate: event?.inferred_date || event?.created_at,
    location: event?.cities && event.cities.length > 0 ? {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: event.cities[0]
      }
    } : undefined,
    image: photos.length > 0 ? getPreviewUrl(slug!, photos[0].id, photos[0].file_type, photos[0].cache_version) : undefined,
    description: `Photo gallery for ${event?.name} featuring ${photos.length} photos${event?.cities && event.cities.length > 0 ? ` from ${event.cities.join(', ')}` : ''}`
  };

  const previewPhoto = photos.find(p => p.is_featured) || photos[0];
  const previewImageUrl = previewPhoto ? getPreviewUrl(slug!, previewPhoto.id, previewPhoto.file_type, previewPhoto.cache_version) : undefined;
  const isMultiDateView = dates.length > 1;
  const visibleDates = isMultiDateView ? dates.slice(0, visibleDateCount) : dates;
  const visibleSingleDatePhotos = isMultiDateView ? filteredPhotos : filteredPhotos.slice(0, visibleSinglePhotoCount);
  const visiblePhotosForActions = isMultiDateView
    ? visibleDates.flatMap((date) => photosByDate.get(date) || [])
    : visibleSingleDatePhotos;
  const hasMoreGalleryItems = isMultiDateView
    ? visibleDateCount < dates.length
    : visibleSinglePhotoCount < filteredPhotos.length;

  const selectAllVisiblePhotos = async () => {
    let selectedNew = 0;

    visiblePhotosForActions.forEach((photo) => {
      if (!selectedPhotos.has(photo.id)) {
        togglePhotoSelectionBase(photo.id);
        selectedNew += 1;
      }
    });

    if (selectedNew > 0) {
      await haptics.light();
    }
  };

  const toggleFavoriteForSelected = async () => {
    if (selectedPhotos.size === 0) {
      return;
    }

    if (!isAuthenticated) {
      const shouldLogin = await confirm(
        'Login Required',
        'You need to be logged in to update favorites. Would you like to login now?'
      );
      if (shouldLogin) {
        login();
      }
      return;
    }

    try {
      const selectedIds = Array.from(selectedPhotos);
      const allAlreadyFavorited = selectedIds.every((id) => userFavorites.has(id));

      await Promise.all(selectedIds.map((id) => toggleFavoriteAPI(id, allAlreadyFavorited)));

      setUserFavorites((prev) => {
        const next = new Set(prev);
        selectedIds.forEach((id) => {
          if (allAlreadyFavorited) {
            next.delete(id);
          } else {
            next.add(id);
          }
        });
        return next;
      });

      await haptics.light();
      toast.showSuccess(allAlreadyFavorited ? 'Removed selected photos from favorites' : 'Added selected photos to favorites');
    } catch (err) {
      console.error('Failed to update selected favorites:', err);
      toast.showError('Failed to update favorites. Please try again.');
    }
  };

  const toggleFeaturedForSelected = async () => {
    if (!canFeature || selectedPhotos.size === 0) {
      return;
    }

    try {
      const selectedIds = new Set(selectedPhotos);
      const shouldEnableFeatured = photos
        .filter((photo) => selectedIds.has(photo.id))
        .some((photo) => !photo.is_featured);

      await Promise.all(
        Array.from(selectedIds).map((id) => setPhotoFeatured(id, shouldEnableFeatured))
      );

      setPhotos((prev) =>
        prev.map((photo) =>
          selectedIds.has(photo.id)
            ? { ...photo, is_featured: shouldEnableFeatured }
            : photo
        )
      );

      await haptics.light();
      toast.showSuccess(shouldEnableFeatured ? 'Selected photos marked as featured' : 'Removed featured status from selected photos');
    } catch (err) {
      console.error('Failed to update selected featured status:', err);
      toast.showError('Failed to update featured status. You may need admin access.');
    }
  };

  const handleClearSelection = async () => {
    if (selectedPhotos.size === 0) {
      return;
    }
    clearSelection();
    await haptics.selectionChanged();
  };

  // Expands the lazy-render window (visibleDateCount / visibleSinglePhotoCount)
  // just enough to include the given photo id, based on its position in the
  // full `photos` list. Used both when first arriving with a saved target photo
  // and defensively during scroll restoration if the photo turns out not to be
  // rendered yet (e.g. a large event where the initial window undershot it).
  // Returns true if the photo was found (regardless of whether the window
  // needed to grow), false if it isn't in `photos` at all.
  const expandWindowForPhotoId = useCallback((targetPhotoId: string): boolean => {
    const photoIndex = photos.findIndex(p => p.id === targetPhotoId);
    if (photoIndex < 0) return false;

    setVisibleSinglePhotoCount((prev) => Math.max(prev, Math.min(Math.max(140, photoIndex + 80), photos.length)));

    // For multi-date view, find the exact date bucket containing the photo
    // (a proportional estimate can under/overshoot when date buckets are uneven in size).
    const photoDate = photos[photoIndex].capture_time.split('T')[0];
    const uniqueDates = Array.from(new Set(photos.map(p => p.capture_time.split('T')[0]))).sort(
      (a, b) => (sortBy.startsWith('date_desc') ? b.localeCompare(a) : a.localeCompare(b))
    );
    const dateIndex = uniqueDates.indexOf(photoDate);
    setVisibleDateCount((prev) =>
      Math.max(
        prev,
        dateIndex >= 0
          ? Math.min(Math.max(8, dateIndex + 4), uniqueDates.length || 8)
          : (uniqueDates.length || 8)
      )
    );
    return true;
  }, [photos, sortBy]);

  // Navigating to a different event invalidates any pending restore — its target
  // photo belongs to the previous gallery. Without this the stale ref would block
  // the new event from reading its own saved position.
  useEffect(() => {
    restoreTargetRef.current = null;
  }, [slug]);

  // Reset lazy-render windows when gallery context changes.
  // If restoring scroll position, expand window to include the target photo.
  useEffect(() => {
    // Prefer the in-progress restore target over sessionStorage: the restore
    // effect clears sessionStorage once it lands, and this effect re-runs on
    // every photos.length change (cache paint, then network). Reading only
    // sessionStorage meant the second run saw nothing and collapsed the window
    // back to 140 photos — dropping the very element the restore was scrolling to.
    const savedPhotoId = restoreTargetRef.current?.photoId
      ?? sessionStorage.getItem(`gallery_photo_${slug}`);
    if (savedPhotoId && photos.length > 0) {
      const found = expandWindowForPhotoId(savedPhotoId);
      if (!found) {
        setVisibleDateCount(8);
        setVisibleSinglePhotoCount(140);
      }
    } else {
      setVisibleDateCount(8);
      setVisibleSinglePhotoCount(140);
    }
    prefetchedPhotoIdsRef.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sortBy, searchQuery, photos.length]);

  // Load additional sections/photos when scrolling near the sentinel.
  useEffect(() => {
    if (!loadMoreRef.current || !hasMoreGalleryItems) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          if (isMultiDateView) {
            setVisibleDateCount((prev) => Math.min(prev + 4, dates.length));
          } else {
            setVisibleSinglePhotoCount((prev) => Math.min(prev + 80, photos.length));
          }
        });
      },
      { rootMargin: '600px 0px' }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMoreGalleryItems, isMultiDateView, dates.length, photos.length]);

  // Restore scroll position when returning to gallery
  useEffect(() => {
    if (slug && !loading && photos.length > 0) {
      // Read through a ref, and DON'T consume sessionStorage here.
      //
      // This effect depends on `photos`, so it re-runs whenever the array
      // identity changes — which now happens twice on every open: once painting
      // from the IndexedDB cache, once when the network response replaces it.
      // Clearing sessionStorage on the first pass meant the second pass found
      // nothing, cancelled the in-flight restore via its cleanup, and never
      // restarted it. The user landed wherever the collapsed render window
      // happened to leave them. Small events hid this: their target photo is
      // inside the initial 140-photo window either way.
      //
      // The keys are cleared in finishRestore() instead, once the restore has
      // actually landed or definitively given up, so a re-run resumes it.
      if (!restoreTargetRef.current) {
        const savedScroll = sessionStorage.getItem(`gallery_scroll_${slug}`);
        const savedPhotoId = sessionStorage.getItem(`gallery_photo_${slug}`);
        if (savedScroll || savedPhotoId) {
          restoreTargetRef.current = { scrollY: savedScroll ? parseInt(savedScroll, 10) : 0, photoId: savedPhotoId };
        }
      }

      const restoreTarget = restoreTargetRef.current;
      if (restoreTarget) {
        const target = restoreTarget.scrollY;
        const savedPhotoId = restoreTarget.photoId;
        const finishRestore = () => {
          restoreTargetRef.current = null;
          sessionStorage.removeItem(`gallery_scroll_${slug}`);
          sessionStorage.removeItem(`gallery_photo_${slug}`);
        };

        // Poll until the target photo element exists or page is tall enough
        let attempts = 0;
        let cancelled = false;
        let triedExpandingWindow = false;
        // Once the target element is found, the justified grid (react-photo-album)
        // is still settling its layout — it measures the container width via a
        // ResizeObserver and recomputes row heights over the following frames,
        // which shifts the element's position after we've already scrolled to it.
        // Keep re-asserting the scroll position until the page height stops
        // changing so we land on the photo's final, settled position.
        let lastScrollHeight = -1;
        let stableFrames = 0;
        const tryScroll = () => {
          if (cancelled) return;
          // Try to find the specific photo element first
          if (savedPhotoId) {
            const el = document.querySelector(`[data-photo-id="${CSS.escape(savedPhotoId)}"]`);
            if (el) {
              el.scrollIntoView({ block: 'center' });

              const currentScrollHeight = document.documentElement.scrollHeight;
              if (currentScrollHeight === lastScrollHeight) {
                stableFrames++;
              } else {
                stableFrames = 0;
                lastScrollHeight = currentScrollHeight;
              }

              // 6 consecutive unchanged frames (~100ms at 60fps) is enough to be
              // confident the layout has settled; 90 attempts (~1.5s) caps how
              // long we keep polling in case the layout never fully stabilizes.
              if (stableFrames >= 6 || attempts >= 90) {
                // Briefly highlight the restored photo so the user can visually
                // confirm this is the one they were viewing before navigating back.
                el.classList.add('ring-4', 'ring-blue-500', 'ring-offset-2', 'dark:ring-offset-gray-900', 'transition-shadow');
                setTimeout(() => {
                  el.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2', 'dark:ring-offset-gray-900', 'transition-shadow');
                }, 1500);
                finishRestore();
                return;
              }
              attempts++;
              requestAnimationFrame(tryScroll);
              return;
            }

            // Element not found yet. In a large event, the target photo may simply
            // not be rendered yet because it falls outside the initial lazy-render
            // window (visibleDateCount / visibleSinglePhotoCount) — the polling used
            // to just keep waiting for it to appear organically (it never would,
            // since nothing here was asking for more content to render) and after a
            // capped number of attempts fell back to a raw saved scrollY number,
            // which no longer corresponds to the same photo once layout differs.
            // Instead, explicitly grow the render window to include this photo once,
            // then keep polling — the element should appear within a few frames.
            if (!triedExpandingWindow && attempts >= 10) {
              triedExpandingWindow = true;
              const found = expandWindowForPhotoId(savedPhotoId);
              if (!found) {
                // Photo no longer exists in this event (e.g. deleted) — nothing to
                // scroll to; stop polling instead of guessing a scroll position.
                finishRestore();
                return;
              }
            }
          }
          // Fallback to scroll position (only relevant when no specific photo id
          // was saved, e.g. very old sessionStorage entries from before photo-id
          // tracking was added).
          if (!savedPhotoId) {
            if (document.documentElement.scrollHeight >= target + window.innerHeight * 0.5 || attempts >= 60) {
              window.scrollTo(0, target);
              finishRestore();
              return;
            }
          } else if (attempts >= 150) {
            // Expanded the window but the element still never showed up (e.g. it's
            // filtered out by the current search/media-type filter) — give up
            // gracefully rather than polling forever.
            finishRestore();
            return;
          }
          attempts++;
          requestAnimationFrame(tryScroll);
        };
        requestAnimationFrame(tryScroll);
        return () => {
          cancelled = true;
        };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, loading, photos]);

  // Prefetch upcoming preview images based on scroll direction.
  useEffect(() => {
    const prefetchPhotos = (candidatePhotos: Photo[]) => {
      candidatePhotos.forEach((photo) => {
        const cacheKey = `${slug}-${photo.id}`;
        if (prefetchedPhotoIdsRef.current.has(cacheKey)) {
          return;
        }

        const image = new Image();
        image.src = getPreviewUrl(slug!, photo.id, photo.file_type, photo.cache_version);
        prefetchedPhotoIdsRef.current.add(cacheKey);
      });
    };

    let ticking = false;

    const onScroll = () => {
      if (ticking) {
        return;
      }

      ticking = true;
      requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const scrollingDown = currentScrollY >= lastScrollYRef.current;
        lastScrollYRef.current = currentScrollY;

        if (scrollingDown) {
          if (isMultiDateView) {
            const nextDates = dates.slice(visibleDateCount, visibleDateCount + 2);
            const upcoming = nextDates.flatMap((date) => photosByDate.get(date) || []).slice(0, 24);
            prefetchPhotos(upcoming);
          } else {
            const upcoming = photos.slice(visibleSinglePhotoCount, visibleSinglePhotoCount + 24);
            prefetchPhotos(upcoming);
          }
        } else {
          if (isMultiDateView) {
            const previousStart = Math.max(0, visibleDateCount - 4);
            const previousDates = dates.slice(previousStart, Math.max(previousStart, visibleDateCount - 1));
            const previous = previousDates.flatMap((date) => photosByDate.get(date) || []).slice(-24);
            prefetchPhotos(previous);
          } else {
            const previousStart = Math.max(0, visibleSinglePhotoCount - 48);
            const previous = photos.slice(previousStart, previousStart + 24);
            prefetchPhotos(previous);
          }
        }

        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [dates, isMultiDateView, photos, photosByDate, slug, visibleDateCount, visibleSinglePhotoCount]);

  // Mobile convenience: tap outside cards/controls to exit selection mode.
  // Uses 'click' (not 'pointerdown') so a scroll/swipe gesture that merely
  // *starts* on an empty area between grid tiles never exits selection mode —
  // mobile browsers only synthesize a 'click' for a genuine tap (pointerdown +
  // pointerup with negligible movement), never for a drag/scroll. Reading the
  // latest selection state via refs (instead of listing it in the dependency
  // array) keeps this listener registered exactly once for the lifetime of
  // `isMobile`/`supportsHover`, so it can never be torn down and re-attached
  // mid-gesture when photos are refetched (uploads completing, sort changes,
  // pull-to-refresh, etc.) — a previous version depended on `clearSelection`
  // and `selectedPhotos.size`, both of which changed identity/value on every
  // photo refetch.
  const selectedPhotosSizeRef = useRef(selectedPhotos.size);
  selectedPhotosSizeRef.current = selectedPhotos.size;
  const clearSelectionRef = useRef(clearSelection);
  clearSelectionRef.current = clearSelection;

  useEffect(() => {
    if (supportsHover || !isMobile) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (selectedPhotosSizeRef.current === 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (
        target.closest('[data-photo-card="true"]') ||
        target.closest('[data-selection-toolbar="true"]') ||
        target.closest('[data-gallery-controls="true"]') ||
        target.closest('button, a, input, select, textarea, [role="button"]')
      ) {
        return;
      }

      clearSelectionRef.current();
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [isMobile, supportsHover]);

  // Keyboard support for power users. Latest values are read from a ref
  // (updated every render) so the listener is registered exactly once instead
  // of being torn down/re-attached on every photo refetch or selection change.
  const keyHandlerStateRef = useRef({
    activeDate,
    clearSelection,
    isMultiDateView,
    photos,
    photosByDate,
    selectedPhotos,
    togglePhotoSelectionBase,
    visiblePhotosForActions,
    toggleFavoriteForSelected,
  });
  keyHandlerStateRef.current = {
    activeDate,
    clearSelection,
    isMultiDateView,
    photos,
    photosByDate,
    selectedPhotos,
    togglePhotoSelectionBase,
    visiblePhotosForActions,
    toggleFavoriteForSelected,
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const {
        activeDate: currentActiveDate,
        clearSelection: currentClearSelection,
        isMultiDateView: currentIsMultiDateView,
        photos: currentPhotos,
        photosByDate: currentPhotosByDate,
        selectedPhotos: currentSelectedPhotos,
        togglePhotoSelectionBase: currentTogglePhotoSelectionBase,
        visiblePhotosForActions: currentVisiblePhotosForActions,
        toggleFavoriteForSelected: currentToggleFavoriteForSelected,
      } = keyHandlerStateRef.current;

      if (event.key === 'Escape' && currentSelectedPhotos.size > 0) {
        event.preventDefault();
        currentClearSelection();
        return;
      }

      if ((event.key === 'a' || event.key === 'A') && currentPhotos.length > 0) {
        event.preventDefault();

        if (currentIsMultiDateView && currentActiveDate) {
          const activeDatePhotos = currentPhotosByDate.get(currentActiveDate) || [];
          activeDatePhotos.forEach((photo) => {
            if (!currentSelectedPhotos.has(photo.id)) {
              currentTogglePhotoSelectionBase(photo.id);
            }
          });
        } else {
          currentVisiblePhotosForActions.forEach((photo) => {
            if (!currentSelectedPhotos.has(photo.id)) {
              currentTogglePhotoSelectionBase(photo.id);
            }
          });
        }
        return;
      }

      if ((event.key === 'f' || event.key === 'F') && currentSelectedPhotos.size > 0) {
        event.preventDefault();
        void currentToggleFavoriteForSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Navbar />
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
          <GallerySkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    );
  }

  if (!authenticated && event?.requires_password) {
    return <EventPasswordForm eventName={event.name} onSubmit={handleLogin} />;
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-white to-slate-50 dark:from-gray-900 dark:to-gray-950 flex flex-col"
      onDragOver={canUpload ? handleDragOver : undefined}
      onDragLeave={canUpload ? handleDragLeave : undefined}
      onDrop={canUpload ? handleDrop : undefined}
    >
      {ConfirmDialog}

      {/* Upload Panel (floating progress indicator) */}
      {canUpload && slug && (
        <UploadPanel slug={slug} onUploadsComplete={loadPhotos} />
      )}

      {/* Event Settings Modal */}
      {isAdmin && event && (
        <EventFormModal
          isOpen={showEventSettings}
          onClose={() => setShowEventSettings(false)}
          event={event}
          onSuccess={() => {
            loadEvent();
            loadPhotos();
          }}
        />
      )}

      <AlbumPicker
        isOpen={showCopyPicker}
        onClose={() => setShowCopyPicker(false)}
        onSelectAlbum={(targetSlug) => {
          void handleBulkCopy(targetSlug);
        }}
        excludeSlug={slug}
        title="Copy to Album"
        description="Choose an album to copy the selected photos to"
      />
      {isAdmin && (
        <EventLocationPicker
          isOpen={showLocationPicker}
          onClose={() => setShowLocationPicker(false)}
          onSetLocation={(lat, lng) => {
            void handleBulkSetLocation(lat, lng);
          }}
        />
      )}
      {showPeopleTagPicker && (
        <div
          className="fixed inset-0 bg-black/75 flex items-center justify-center z-[100] p-4"
          onClick={() => !taggingPeople && setShowPeopleTagPicker(false)}
        >
          <div
            className="bg-gray-800 rounded-lg p-6 max-w-md w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5" /> Tag people on {selectedPhotos.size} photo{selectedPhotos.size === 1 ? '' : 's'}
              </h2>
              <button
                onClick={() => setShowPeopleTagPicker(false)}
                disabled={taggingPeople}
                className="text-gray-400 hover:text-white disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-3 shrink-0">
              Adds the selected people to every chosen photo — existing tags on these photos are kept.
            </p>

            <input
              type="text"
              value={peopleTagSearchQuery}
              onChange={(e) => setPeopleTagSearchQuery(e.target.value)}
              placeholder="Search people..."
              className="mb-3 w-full px-3 py-2 bg-gray-700 text-white rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
            />

            <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1">
              {namedPeopleLoading ? (
                <p className="text-gray-400 text-sm py-4 text-center">Loading people...</p>
              ) : namedPeople.length === 0 ? (
                <p className="text-gray-400 text-sm py-4 text-center">
                  No named people yet — name someone in Admin → People first.
                </p>
              ) : (
                namedPeople
                  .filter((p) => p.name.toLowerCase().includes(peopleTagSearchQuery.trim().toLowerCase()))
                  .map((p) => {
                    const selected = peopleTagSelection.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleToggleTagPersonSelection(p.id)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                          selected ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-200 hover:bg-gray-700'
                        }`}
                      >
                        <span>{p.name}</span>
                        {selected && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                    );
                  })
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-700 shrink-0">
              <button
                onClick={handleBulkUntagPeople}
                disabled={taggingPeople}
                className="w-full py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <UserX className="w-4 h-4" /> Remove all people (person: none)
              </button>
            </div>

            <div className="flex gap-2.5 mt-4 shrink-0">
              <button
                onClick={() => setShowPeopleTagPicker(false)}
                disabled={taggingPeople}
                className="flex-1 py-2.5 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-600 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkTagPeople}
                disabled={taggingPeople || peopleTagSelection.size === 0}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {taggingPeople ? 'Tagging...' : 'Tag People'}
              </button>
            </div>
          </div>
        </div>
      )}
      <SEO
        title={`${event?.name || 'Event Gallery'} - ${config.appName}`}
        description={`Browse ${photos.length} photos from ${event?.name}${event?.cities && event.cities.length > 0 ? ` in ${event.cities.join(', ')}` : ''}. Professional event photography featuring ice skating and inline skating.`}
        keywords={`${event?.name}, event photography, ${event?.cities?.join(', ')}, ice skating, inline skating`}
        url={`${window.location.origin}/events/${slug}`}
        type="article"
        image={previewImageUrl}
        structuredData={structuredData}
      />
      <Navbar />
      {/* Add padding when photos are selected to account for fixed action bar */}
      <div className={`max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-8 py-4 sm:py-6 flex-grow w-full transition-all ${
        selectedPhotos.size > 0 ? 'pt-16 sm:pt-20' : ''
      }`}>
        <div className="mb-4 sm:mb-6">
          <Link to="/events" className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mb-2 inline-block text-sm font-medium">
            ← Back to Events
          </Link>
          
          {/* Header: everything about this event (title, badge, collaborators, and every
              action) lives in ONE wrapping row instead of stacking title/collaborators/actions
              as three separate full-width rows — this used to eat a lot of vertical space
              before any photos were even visible, especially once the People filter/action-bar
              functionality was added on top. */}
          <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
            <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">{event?.name}</h1>
              {event && (
                <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${
                  event.requires_password
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                    : event.visibility === 'public' 
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : event.visibility === 'collaborators_only'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                    : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                }`}>
                  {event.requires_password
                    ? 'Password Protected'
                    : event.visibility === 'public' 
                    ? 'Public'
                    : event.visibility === 'collaborators_only'
                    ? 'Invite Only'
                    : 'Private'}
                </span>
              )}
            </div>
            {event && (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {event.visibility === 'collaborators_only' && collaborators.length > 0 && (
                  <>
                    <CollaboratorAvatars collaborators={collaborators} size={8} showLabel={false} />
                    <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-0.5" />
                  </>
                )}
                {collaboratorRole && !isAdmin && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">({collaboratorRole})</span>
                )}
                {/* One consistent style for every action here: neutral gray pills, except
                    Upload — the single primary/most-frequent action — which is the only blue
                    one. Ordered by how often each is used (Upload first, Settings last) rather
                    than the previous ad-hoc order/mismatched colors (blue Share, indigo Upload,
                    gray everything else) that looked like a mess of unrelated buttons. */}
                {canUpload && (
                  <label className="inline-flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors text-sm font-medium cursor-pointer">
                    <Upload className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">Upload</span>
                    <input type="file" multiple accept="image/jpeg,image/png,video/mp4,video/quicktime,.mov,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.ptx,.srw,.raw,.rwl,.erf,.kdc,.dcr,.mrw,.x3f,.3fr,.mef,.mos,.iiq" onChange={handleFileInput} className="hidden" />
                  </label>
                )}
                {filteredPhotos.length > 0 && (
                  <CastButton
                    slug={slug!}
                    variant="labeled"
                    getMedia={() => ({
                      type: 'album',
                      items: filteredPhotos.map((p) => ({
                        url: getCastPreviewUrl(slug!, p.id, p.file_type, p.cache_version),
                        type: p.file_type === 'video/mp4' ? 'video' : 'photo',
                        title: p.original_filename,
                      })),
                    })}
                  />
                )}
                <ShareEventButton
                  event={event}
                  slug={slug!}
                  photos={photos}
                  canInvite={event.visibility === 'collaborators_only' && canCreateInvite}
                />
                {isAdmin && (
                  <button
                    onClick={() => setShowEventSettings(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
                  >
                    <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">Settings</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sort & Filter Options - Mobile optimized (the people filter — available to every
            viewer — is folded into this same bar via GallerySortFilter's
            namedPeople/selectedPersonIds/onTogglePerson props, instead of its own separate row). */}
        <GallerySortFilter
          sortBy={sortBy}
          onSortChange={setSortBy}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          mediaTypeFilter={mediaTypeFilter}
          onMediaTypeFilterChange={setMediaTypeFilter}
          selectedCount={selectedPhotos.size}
          onSelectAllVisible={selectAllVisiblePhotos}
          onClearSelection={() => {
            void handleClearSelection();
          }}
          onToggleFavoriteSelected={() => {
            void toggleFavoriteForSelected();
          }}
          onToggleFeaturedSelected={
            canFeature
              ? () => {
                  void toggleFeaturedForSelected();
                }
              : undefined
          }
          showFeaturedAction={canFeature}
          onDownloadSelected={downloadSelected}
          onCopySelected={canDelete ? () => setShowCopyPicker(true) : undefined}
          onDeleteSelected={canDelete ? handleBulkDelete : undefined}
          isAdmin={canDelete}
          isDeleting={deleting}
          isCopying={copying}
          onSetLocationSelected={isAdmin ? () => setShowLocationPicker(true) : undefined}
          onTagPeopleSelected={canDelete ? handleOpenPeopleTagPicker : undefined}
          isGlobalAdmin={isAdmin}
          density={density}
          onDensityChange={changeDensity}
          namedPeople={galleryFilterPeople}
          selectedPersonIds={peopleFilterIds}
          onTogglePerson={handleToggleGalleryPersonFilter}
        />

        {/* Duplicate photos banner */}
        {canDelete && duplicateGroups.length > 0 && !duplicateBannerDismissed && (
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 px-4 py-3">
            <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
              Found {duplicatePhotoCount} duplicate photo{duplicatePhotoCount === 1 ? '' : 's'} in {duplicateGroups.length === 1 ? 'this album' : `${duplicateGroups.length} sets`}. Would you like to remove {duplicatePhotoCount === 1 ? 'it' : 'them'}?
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleRemoveDuplicates}
                disabled={removingDuplicates}
                className="px-3 py-1.5 text-sm font-medium bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-full transition-colors"
              >
                {removingDuplicates ? 'Removing…' : 'Remove Duplicates'}
              </button>
              <button
                onClick={() => setDuplicateBannerDismissed(true)}
                className="px-3 py-1.5 text-sm text-amber-800 dark:text-amber-200 hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Vertical date scrubber - only for multi-day events; replaces the old
            horizontal fixed bar so photos aren't pushed down by a full-width
            overlay, and the whole date range is reachable in one drag gesture. */}
        {isMultiDateView && (
          <VerticalDateScrubber
            dates={dates}
            activeDate={activeDate}
            onSelectDate={handleDateClick}
          />
        )}

        {/* Gallery */}
        {photos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">No photos found.</p>
          </div>
        ) : filteredPhotos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">No photos match "{searchQuery}"</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-blue-600 dark:text-blue-400 text-sm hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : isMultiDateView ? (
          // Multi-date view with date headers
          <div className="space-y-7" ref={densityContainerRef}>
            {visibleDates.map((date) => {
              const datePhotos = photosByDate.get(date) || [];
              const dateObj = new Date(date);
              const formattedDate = dateObj.toLocaleDateString('en-US', { 
                weekday: 'long',
                year: 'numeric',
                month: 'long', 
                day: 'numeric' 
              });
              
              return (
                <div 
                  key={date} 
                  data-date={date}
                  ref={(el) => {
                    if (el) {
                      dateRefs.current.set(date, el);
                    } else {
                      dateRefs.current.delete(date);
                    }
                  }}
                >
                  {/* Date header */}
                  <div className="mb-3 sm:mb-4 flex items-center justify-between sticky top-16 z-20 backdrop-blur-sm bg-white/80 dark:bg-gray-900/70 rounded-xl px-3 py-2 border border-gray-200/70 dark:border-gray-700/70">
                    <div>
                      <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
                        {formattedDate}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {datePhotos.length} {datePhotos.length === 1 ? 'photo' : 'photos'}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleDateSelection(datePhotos)}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-full transition-colors"
                      title={isDateFullySelected(datePhotos) ? 'Deselect all' : 'Select all'}
                    >
                      {isDateFullySelected(datePhotos) ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  
                  {/* Photos for this date - Justified Grid */}
                  <JustifiedGrid
                    photos={datePhotos}
                    slug={slug!}
                    targetRowHeight={targetRowHeight}
                    spacing={4}
                    selectedPhotos={selectedPhotos}
                    forceControlsVisible={selectedPhotos.size > 0}
                    userFavorites={userFavorites}
                    supportsHover={supportsHover}
                    sortBy={sortBy}
                    onToggleSelection={togglePhotoSelection}
                    onToggleFavorite={toggleFavorite}
                    onToggleFeatured={canFeature ? toggleFeatured : undefined}
                    showFeatured={canFeature}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          // Single-date view (justified grid without date headers)
          <div ref={densityContainerRef}>
            <JustifiedGrid
              photos={visibleSingleDatePhotos}
              slug={slug!}
              targetRowHeight={targetRowHeight}
              spacing={4}
              selectedPhotos={selectedPhotos}
              forceControlsVisible={selectedPhotos.size > 0}
              userFavorites={userFavorites}
              supportsHover={supportsHover}
              sortBy={sortBy}
              onToggleSelection={togglePhotoSelection}
              onToggleFavorite={toggleFavorite}
              onToggleFeatured={canFeature ? toggleFeatured : undefined}
              showFeatured={canFeature}
            />
          </div>
        )}

        {hasMoreGalleryItems && (
          <div ref={loadMoreRef} className="h-12" aria-hidden="true" />
        )}
      </div>
      <Footer />
    </div>
  );
};

export default EventGallery;
