import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Share2, Upload } from 'lucide-react';
import Masonry from 'react-masonry-css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PhotoCard from '../components/PhotoCard';
import DateTimeline from '../components/DateTimeline';
import SEO from '../components/SEO';
import { getEvent, getPhotos, loginToEvent, getPreviewUrl, requestZip, downloadZip, setPhotoFeatured, getUserFavoriteIds, toggleFavorite as toggleFavoriteAPI, bulkDeletePhotos, getUserCollaborations, getCollaborators } from '../api';
import type { Event, Photo, Collaborator } from '../types';
import { CollaboratorAvatars } from '../components/CollaboratorAvatars';
import { useAuth } from '../contexts/AuthContext';

const EventGallery: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { isAuthenticated, login, user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('date_asc');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isCollaborator, setIsCollaborator] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const dateRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (slug) {
      loadEvent();
    }
  }, [slug]);

  useEffect(() => {
    // Load user favorites and check collaborator status if authenticated
    const loadUserData = async () => {
      if (isAuthenticated && slug) {
        try {
          const [favorites, collabData] = await Promise.all([
            getUserFavoriteIds(),
            getUserCollaborations()
          ]);
          const favoriteIds = new Set(favorites.map(f => f.photoId));
          setUserFavorites(favoriteIds);
          
          // Check if user is a collaborator on this event
          const isCollab = collabData.collaborations.some(c => c.event_slug === slug);
          setIsCollaborator(isCollab);
        } catch (err) {
          console.error('Failed to load user data:', err);
        }
      } else {
        setUserFavorites(new Set());
        setIsCollaborator(false);
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

  // Restore scroll position when returning to gallery
  useEffect(() => {
    if (slug && !loading && photos.length > 0) {
      const savedScroll = sessionStorage.getItem(`gallery_scroll_${slug}`);
      if (savedScroll) {
        // Use setTimeout to ensure DOM has rendered
        setTimeout(() => {
          window.scrollTo(0, parseInt(savedScroll, 10));
          // Clear the saved position after restoring
          sessionStorage.removeItem(`gallery_scroll_${slug}`);
        }, 100);
      }
    }
  }, [slug, loading, photos]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      if (slug) {
        const savedScroll = sessionStorage.getItem(`gallery_scroll_${slug}`);
        if (savedScroll) {
          // Delay slightly to ensure page is rendered
          setTimeout(() => {
            window.scrollTo(0, parseInt(savedScroll, 10));
            sessionStorage.removeItem(`gallery_scroll_${slug}`);
          }, 100);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [slug]);

  useEffect(() => {
    // Load selected photos from localStorage (for download selection)
    if (slug) {
      const stored = localStorage.getItem(`favorites_${slug}`);
      if (stored) {
        setSelectedPhotos(new Set(JSON.parse(stored)));
      }
    }
  }, [slug]);

  useEffect(() => {
    // Save selected photos to localStorage
    if (slug) {
      localStorage.setItem(`favorites_${slug}`, JSON.stringify(Array.from(selectedPhotos)));
    }
  }, [selectedPhotos, slug]);

  const loadEvent = async () => {
    try {
      setLoading(true);
      const eventData = await getEvent(slug!);
      setEvent(eventData);
      
      // If event doesn't require password, load photos immediately
      if (!eventData.requires_password) {
        try {
          const photoData = await getPhotos(slug!, sortBy);
          setPhotos(photoData);
          setAuthenticated(true);
        } catch (err) {
          console.error('Failed to load photos for public event:', err);
        }
      } else {
        // Try to load photos (will succeed if already authenticated)
        try {
          const photoData = await getPhotos(slug!, sortBy);
          setPhotos(photoData);
          setAuthenticated(true);
        } catch {
          // Not authenticated yet
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await loginToEvent(slug!, password);
      setAuthenticated(true);
      setLoginError(null);
      await loadPhotos();
    } catch (err) {
      setLoginError('Invalid password');
      console.error(err);
    }
  };

  const loadPhotos = async () => {
    try {
      const photoData = await getPhotos(slug!, sortBy);
      setPhotos(photoData);
    } catch (err) {
      console.error(err);
    }
  };

  // Reload photos when sort changes
  useEffect(() => {
    if (authenticated && slug) {
      loadPhotos();
    }
  }, [sortBy]);

  const toggleSelection = (photoId: string) => {
    const newSelected = new Set(selectedPhotos);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedPhotos(newSelected);
  };

  const toggleDateSelection = (datePhotos: Photo[]) => {
    const datePhotoIds = datePhotos.map(p => p.id);
    const allSelected = datePhotoIds.every(id => selectedPhotos.has(id));
    
    const newSelected = new Set(selectedPhotos);
    if (allSelected) {
      // Deselect all from this date
      datePhotoIds.forEach(id => newSelected.delete(id));
    } else {
      // Select all from this date
      datePhotoIds.forEach(id => newSelected.add(id));
    }
    setSelectedPhotos(newSelected);
  };

  const toggleFavorite = async (photoId: string, isFavorited: boolean) => {
    // Require authentication for favorites
    if (!isAuthenticated) {
      const shouldLogin = window.confirm('You need to be logged in to save favorites. Would you like to login now?');
      if (shouldLogin) {
        login();
      }
      return;
    }
    
    try {
      await toggleFavoriteAPI(photoId, isFavorited);
      
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
      alert('Failed to update favorite. Please try again.');
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
      alert('Failed to update featured status. You may need admin access.');
    }
  };

  const downloadSelected = async () => {
    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      alert('No photos selected');
      return;
    }
    
    if (selected.length > 50) {
      alert('Maximum 50 photos can be downloaded at once');
      return;
    }
    
    try {
      // Request ZIP file from server
      const zipBlob = await requestZip(slug!, selected);
      
      // Download using platform-specific method
      const timestamp = new Date().toISOString().split('T')[0];
      await downloadZip(zipBlob, `${slug}_${timestamp}.zip`);
    } catch (error) {
      console.error('Error downloading ZIP:', error);
      alert('Failed to download ZIP file');
    }
  };

  const handleBulkDelete = async () => {
    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      alert('No photos selected');
      return;
    }
    
    const confirmed = window.confirm(
      `Are you sure you want to delete ${selected.length} selected photo(s)? This cannot be undone!`
    );
    
    if (!confirmed) return;
    
    try {
      setDeleting(true);
      
      // Use bulk delete API
      const result = await bulkDeletePhotos(selected);
      
      // Reload photos
      await loadPhotos();
      setSelectedPhotos(new Set());
      
      if (result.deletedCount === result.totalRequested) {
        alert(`Successfully deleted ${result.deletedCount} photo(s)`);
      } else {
        alert(`Deleted ${result.deletedCount} of ${result.totalRequested} photo(s). Some photos may have failed to delete.`);
      }
    } catch (error) {
      console.error('Error deleting photos:', error);
      alert('Failed to delete photos. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const shareEvent = async (platform?: string) => {
    const url = `${window.location.origin}/events/${slug}`;
    const text = `Check out ${event?.name} photo gallery`;
    
    // Use native share API on mobile if available and no platform specified
    if (!platform && 'share' in navigator) {
      try {
        const shareData: any = {
          title: event?.name || 'Photo Gallery',
          text: text,
          url: url,
        };
        
        // Try to include a representative photo from the album
        if (photos.length > 0) {
          try {
            // Use first photo or first featured photo as representative
            const representativePhoto = photos.find(p => p.is_featured) || photos[0];
            const imageUrl = getPreviewUrl(slug!, representativePhoto.id);
            
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const fileName = `${slug}-preview.jpg`;
            const file = new File([blob], fileName, { type: blob.type });
            
            // Check if we can share files
            if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
              shareData.files = [file];
            }
          } catch (err) {
            console.log('Could not include photo in share, sharing URL only:', err);
          }
        }
        
        await (navigator as any).share(shareData);
        setShowShareMenu(false);
        return;
      } catch (err) {
        // User cancelled or share failed
        if ((err as Error).name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
        return;
      }
    }
    
    // Fall back to platform-specific sharing
    switch (platform) {
      case 'twitter':
        window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
        break;
      case 'facebook':
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
        break;
      case 'whatsapp':
        window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
        break;
      case 'copy':
        navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
        break;
    }
    setShowShareMenu(false);
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

  const { groups: photosByDate, dates } = groupPhotosByDate(photos);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
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
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">{event?.name}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">This event is password protected. Please enter the password to view photos.</p>
          
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg mb-4 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              required
            />
            
            {loginError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-4">
                {loginError}
              </div>
            )}
            
            <button
              type="submit"
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Unlock Gallery
            </button>
          </form>
          
            <Link to="/events" className="block mt-4 text-center text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
            ← Back to Events
          </Link>
        </div>
      </div>
    );
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event?.name || '',
    url: `https://photos.thijsvtol.nl/events/${slug}`,
    startDate: event?.inferred_date || event?.created_at,
    location: event?.cities && event.cities.length > 0 ? {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: event.cities[0]
      }
    } : undefined,
    image: photos.length > 0 ? getPreviewUrl(slug!, photos[0].id) : undefined,
    description: `Photo gallery for ${event?.name} featuring ${photos.length} photos${event?.cities && event.cities.length > 0 ? ` from ${event.cities.join(', ')}` : ''}`
  };

  const previewPhoto = photos.find(p => p.is_featured) || photos[0];
  const previewImageUrl = previewPhoto ? getPreviewUrl(slug!, previewPhoto.id) : undefined;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <SEO
        title={`${event?.name || 'Event Gallery'} - Thijs van Tol Photos`}
        description={`Browse ${photos.length} photos from ${event?.name}${event?.cities && event.cities.length > 0 ? ` in ${event.cities.join(', ')}` : ''}. Professional event photography featuring ice skating and inline skating.`}
        keywords={`${event?.name}, event photography, ${event?.cities?.join(', ')}, ice skating, inline skating`}
        url={`https://photos.thijsvtol.nl/events/${slug}`}
        type="article"
        image={previewImageUrl}
        structuredData={structuredData}
      />
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
        <div className="mb-6 sm:mb-8">
          <Link to="/events" className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mb-3 sm:mb-4 inline-block text-sm sm:text-base">
            ← Back to Events
          </Link>
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1">
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">{event?.name}</h1>
              {event && (
                <span className={`inline-block mt-2 px-2 py-1 text-xs rounded-full ${
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
                    ? 'Public Gallery'
                    : event.visibility === 'collaborators_only'
                    ? 'Invite Only'
                    : 'Private Gallery'}
                </span>
              )}
              {event && event.visibility === 'collaborators_only' && collaborators.length > 0 && (
                <div className="mt-4">
                  <CollaboratorAvatars collaborators={collaborators} />
                </div>
              )}
            </div>
            {/* Share button */}
            <div className="relative">
              <button
                onClick={() => {
                  if ('share' in navigator) {
                    shareEvent();
                  } else {
                    setShowShareMenu(!showShareMenu);
                  }
                }}
                className="px-3 py-2 sm:px-4 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2 text-sm font-medium"
                aria-label="Share album"
              >
                <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">Share</span>
              </button>
              
              {/* Desktop share menu dropdown */}
              {showShareMenu && !('share' in navigator) && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-30">
                  <button
                    onClick={() => shareEvent('twitter')}
                    className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>🐦</span> Twitter
                  </button>
                  <button
                    onClick={() => shareEvent('facebook')}
                    className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>📘</span> Facebook
                  </button>
                  <button
                    onClick={() => shareEvent('whatsapp')}
                    className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>💬</span> WhatsApp
                  </button>
                  <button
                    onClick={() => shareEvent('copy')}
                    className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>🔗</span> Copy Link
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Upload button for admins and collaborators */}
        {(isAdmin || isCollaborator) && (
          <div className="mb-4">
            <Link
              to={`/admin/events/${slug}/upload`}
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 active:scale-95 transition-all text-sm font-semibold shadow-md"
            >
              <Upload className="w-5 h-5" />
              Upload Photos/Videos
            </Link>
            {isCollaborator && !isAdmin && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                You've been invited to contribute to this event
              </p>
            )}
          </div>
        )}

        {/* Sort & Filter Options - Mobile optimized */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 sm:p-4 mb-6">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 sm:items-center">
            <div className="flex-1 sm:flex-none">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full sm:w-auto px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="date_desc">Date (Newest First)</option>
                <option value="date_asc">Date (Oldest First)</option>
                <option value="name_asc">Name (A-Z)</option>
                <option value="name_desc">Name (Z-A)</option>
              </select>
            </div>
            {selectedPhotos.size > 0 && (
              <>
                <button
                  onClick={downloadSelected}
                  className="w-full sm:w-auto px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 active:scale-95 transition-all text-sm font-semibold shadow-md flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="hidden sm:inline">Download Selected</span>
                  <span className="sm:hidden">Download</span>
                  <span>({selectedPhotos.size})</span>
                </button>
                {isAdmin && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={deleting}
                    className="w-full sm:w-auto px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 active:scale-95 transition-all text-sm font-semibold shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span>{deleting ? 'Deleting...' : 'Delete Selected'}</span>
                    <span>({selectedPhotos.size})</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Date Timeline - Only show for multi-day events */}
        {dates.length > 1 && (
          <div className="-mx-3 sm:-mx-4 lg:-mx-8 mb-6">
            <DateTimeline 
              dates={dates} 
              activeDate={activeDate} 
              onDateClick={handleDateClick} 
            />
          </div>
        )}

        {/* Gallery */}
        {photos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600">No photos found.</p>
          </div>
        ) : dates.length > 1 ? (
          // Multi-date view with date headers
          <div className="space-y-8">
            {dates.map((date) => {
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
                  <div className="mb-4 pb-2 border-b-2 border-gray-200 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                        {formattedDate}
                      </h2>
                      <p className="text-sm text-gray-500 mt-1">
                        {datePhotos.length} {datePhotos.length === 1 ? 'photo' : 'photos'}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleDateSelection(datePhotos)}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      title={datePhotos.every(p => selectedPhotos.has(p.id)) ? 'Deselect all' : 'Select all'}
                    >
                      {datePhotos.every(p => selectedPhotos.has(p.id)) ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  
                  {/* Photos for this date */}
                  <Masonry
                    breakpointCols={{
                      default: 4,
                      1536: 4,
                      1280: 3,
                      1024: 3,
                      768: 2,
                      640: 2
                    }}
                    className="flex -ml-2 sm:-ml-4 w-auto"
                    columnClassName="pl-2 sm:pl-4 bg-clip-padding"
                  >
                    {datePhotos.map((photo) => (
                      <PhotoCard
                        key={photo.id}
                        photo={photo}
                        slug={slug!}
                        sortBy={sortBy}
                        showSelection={true}
                        isSelected={selectedPhotos.has(photo.id)}
                        onToggleSelection={toggleSelection}
                        showAddToFavorites={true}
                        onToggleFavorite={toggleFavorite}
                        showFeatured={isAdmin}
                        onToggleFeatured={toggleFeatured}
                        userFavorites={userFavorites}
                      />
                    ))}
                  </Masonry>
                </div>
              );
            })}
          </div>
        ) : (
          // Single-date view (original masonry without date headers)
          <Masonry
            breakpointCols={{
              default: 4,
              1536: 4,
              1280: 3,
              1024: 3,
              768: 2,
              640: 2
            }}
            className="flex -ml-2 sm:-ml-4 w-auto"
            columnClassName="pl-2 sm:pl-4 bg-clip-padding"
          >
            {photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                slug={slug!}
                sortBy={sortBy}
                showSelection={true}
                isSelected={selectedPhotos.has(photo.id)}
                onToggleSelection={toggleSelection}
                showAddToFavorites={true}
                onToggleFavorite={toggleFavorite}
                showFeatured={isAdmin}
                onToggleFeatured={toggleFeatured}
                userFavorites={userFavorites}
              />
            ))}
          </Masonry>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default EventGallery;
