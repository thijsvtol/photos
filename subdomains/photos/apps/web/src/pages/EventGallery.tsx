import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Upload, Copy, Check } from 'lucide-react';
import Masonry from 'react-masonry-css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PhotoCard from '../components/PhotoCard';
import DateTimeline from '../components/DateTimeline';
import SEO from '../components/SEO';
import { useRefresh } from '../contexts/RefreshContext';
import { EventPasswordForm } from '../components/EventPasswordForm';
import { GallerySortFilter } from '../components/GallerySortFilter';
import { ShareEventButton } from '../components/ShareEventButton';
import { getEvent, getPhotos, loginToEvent, getPreviewUrl, requestZip, downloadZip, setPhotoFeatured, getUserFavoriteIds, toggleFavorite as toggleFavoriteAPI, bulkDeletePhotos, getUserCollaborations, getCollaborators, getInviteLinks, createInviteLink } from '../api';
import type { Event, Photo, Collaborator, InviteLink } from '../types';
import { CollaboratorAvatars } from '../components/CollaboratorAvatars';
import { useAuth } from '../contexts/AuthContext';
import { usePhotoSelection } from '../hooks/usePhotoSelection';
import { config } from '../config';

const EventGallery: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { isAuthenticated, login, user } = useAuth();
  const { registerRefreshHandler, unregisterRefreshHandler } = useRefresh();
  const isAdmin = user?.isAdmin === true;
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('date_asc');
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [isCollaborator, setIsCollaborator] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [inviteLink, setInviteLink] = useState<InviteLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const dateRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [isMobile, setIsMobile] = useState(false);
  
  // Use custom hook for photo selection
  const {
    selectedPhotos,
    togglePhotoSelection,
    clearSelection,
    toggleDateSelection,
    isDateFullySelected,
  } = usePhotoSelection(photos);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640); // sm breakpoint
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (slug) {
      loadEvent();
    }
  }, [slug]);

  // Register refresh handler
  useEffect(() => {
    if (authenticated) {
      registerRefreshHandler(handleRefresh);
      return () => unregisterRefreshHandler();
    }
  }, [authenticated]);

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

  // Load invite link for collaborators-only events (admin and collaborators)
  useEffect(() => {
    const loadInviteLink = async () => {
      if (event && event.visibility === 'collaborators_only' && slug && (isAdmin || isCollaborator)) {
        try {
          const links = await getInviteLinks(slug);
          if (links.length > 0) {
            // Use the first active link
            setInviteLink(links[0]);
          } else if (isAdmin) {
            // Only admins can create new invite links
            const newLink = await createInviteLink(slug);
            setInviteLink(newLink);
          }
        } catch (err) {
          console.error('Failed to load/create invite link:', err);
          // Silently fail - invite link is optional
        }
      } else {
        setInviteLink(null);
      }
    };
    loadInviteLink();
  }, [event, slug, isAdmin, isCollaborator]);

  const copyCollaborationLink = async () => {
    if (!inviteLink) return;
    
    const fullUrl = `${window.location.origin}/invite/${inviteLink.token}`;
    
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      alert('Failed to copy link to clipboard');
    }
  };


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

  const handleLogin = async (password: string) => {
    await loginToEvent(slug!, password);
    setAuthenticated(true);
    await loadPhotos();
  };

  const loadPhotos = async () => {
    try {
      const photoData = await getPhotos(slug!, sortBy);
      setPhotos(photoData);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRefresh = async () => {
    if (authenticated) {
      await Promise.all([loadEvent(), loadPhotos()]);
    }
  };

  // Reload photos when sort changes
  useEffect(() => {
    if (authenticated && slug) {
      loadPhotos();
    }
  }, [sortBy]);

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
      clearSelection();
      
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
    return <EventPasswordForm eventName={event.name} onSubmit={handleLogin} />;
  }

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
    image: photos.length > 0 ? getPreviewUrl(slug!, photos[0].id) : undefined,
    description: `Photo gallery for ${event?.name} featuring ${photos.length} photos${event?.cities && event.cities.length > 0 ? ` from ${event.cities.join(', ')}` : ''}`
  };

  const previewPhoto = photos.find(p => p.is_featured) || photos[0];
  const previewImageUrl = previewPhoto ? getPreviewUrl(slug!, previewPhoto.id) : undefined;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
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
      <div className={`max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full transition-all ${
        selectedPhotos.size > 0 ? 'pt-16 sm:pt-20' : ''
      }`}>
        <div className="mb-4 sm:mb-6">
          <Link to="/events" className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mb-2 inline-block text-sm">
            ← Back to Events
          </Link>
          
          {/* Header: Title, Badge, and Share Button */}
          <div className="flex justify-between items-start gap-4 mb-3">
            <div className="flex-1 flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{event?.name}</h1>
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
            {event && <ShareEventButton event={event} slug={slug!} photos={photos} />}
          </div>

          {/* Collaborators and Copy Link - Compact Row */}
          {event && event.visibility === 'collaborators_only' && collaborators.length > 0 && (
            <div className="flex items-center gap-3 mb-3">
              <CollaboratorAvatars collaborators={collaborators} />
              {(isAdmin || isCollaborator) && inviteLink && (
                <button
                  onClick={copyCollaborationLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-xs font-medium"
                  title="Share this link with others to invite them as collaborators"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Action Buttons Row */}
          {(isAdmin || isCollaborator) && (
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/admin/events/${slug}/upload`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
              >
                <Upload className="w-4 h-4" />
                Upload Photos/Videos
              </Link>
              {isCollaborator && !isAdmin && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  (Collaborator)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sort & Filter Options - Mobile optimized */}
        <GallerySortFilter
          sortBy={sortBy}
          onSortChange={setSortBy}
          selectedCount={selectedPhotos.size}
          onDownloadSelected={downloadSelected}
          onDeleteSelected={isAdmin ? handleBulkDelete : undefined}
          isAdmin={isAdmin}
          isDeleting={deleting}
        />

        {/* Date Timeline - Only show for multi-day events */}
        {dates.length > 1 && (
          <div className="-mx-3 sm:-mx-4 lg:-mx-8 mb-6">
            <DateTimeline 
              dates={dates} 
              activeDate={activeDate} 
              onDateClick={handleDateClick}
              topOffset={selectedPhotos.size > 0 ? (isMobile ? 115 : 120) : 64}
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
                  <div className="mb-4 pb-2 border-b-2 border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                        {formattedDate}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {datePhotos.length} {datePhotos.length === 1 ? 'photo' : 'photos'}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleDateSelection(datePhotos)}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      title={isDateFullySelected(datePhotos) ? 'Deselect all' : 'Select all'}
                    >
                      {isDateFullySelected(datePhotos) ? 'Deselect All' : 'Select All'}
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
                        onToggleSelection={togglePhotoSelection}
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
                onToggleSelection={togglePhotoSelection}
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
