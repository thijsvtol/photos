import { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Capacitor } from '@capacitor/core';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { RefreshProvider } from './contexts/RefreshContext';
import { UploadProvider } from './contexts/UploadContext';
import GlobalUploadIndicator from './components/GlobalUploadIndicator';
import { OfflineBanner } from './components/OfflineBanner';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import PullToRefresh from './components/PullToRefresh';
import { AndroidAppPrompt } from './components/AndroidAppPrompt';
import { initAnalytics, trackPageView } from './services/analytics';
import { useAndroidBackButton } from './hooks/useAndroidBackButton';
import { useStatusBar } from './hooks/useStatusBar';
import { lazyWithReload } from './lazyWithReload';

// Lazy load route components for better code splitting — wrapped in lazyWithReload() so a
// stale hashed-chunk 404 (after a new deploy replaces the file a user's already-open tab still
// references) self-heals with one automatic reload instead of showing a broken page — see
// lazyWithReload.ts's doc comment for the full 2026-08-03 incident this fixes.
const Landing = lazyWithReload(() => import('./pages/Landing'));
const EventList = lazyWithReload(() => import('./pages/EventList'));
const EventGallery = lazyWithReload(() => import('./pages/EventGallery'));
const PhotoDetail = lazyWithReload(() => import('./pages/PhotoDetail'));
const MyFavorites = lazyWithReload(() => import('./pages/MyFavorites'));
const Logout = lazyWithReload(() => import('./pages/Logout'));
const MapView = lazyWithReload(() => import('./pages/MapView'));
const PhotoUsage = lazyWithReload(() => import('./pages/PhotoUsage'));
const InviteAccept = lazyWithReload(() => import('./pages/InviteAccept'));
const PrivacyPolicy = lazyWithReload(() => import('./pages/PrivacyPolicy'));
const ShareUpload = lazyWithReload(() => import('./pages/ShareUpload'));
const Timeline = lazyWithReload(() => import('./pages/Timeline'));
const CastReceiver = lazyWithReload(() => import('./pages/CastReceiver'));
const SearchPage = lazyWithReload(() => import('./pages/SearchPage'));
const AdminPeople = lazyWithReload(() => import('./pages/AdminPeople'));
const AdminPersonDetail = lazyWithReload(() => import('./pages/AdminPersonDetail'));
const AdminDashboard = lazyWithReload(() => import('./pages/AdminDashboard'));
const AdminPhotoManager = lazyWithReload(() => import('./pages/AdminPhotoManager'));
const AdminTagManager = lazyWithReload(() => import('./pages/AdminTagManager'));
const AdminTrash = lazyWithReload(() => import('./pages/AdminTrash'));
const AdminDuplicates = lazyWithReload(() => import('./pages/AdminDuplicates'));
const AdminAlbums = lazyWithReload(() => import('./pages/AdminAlbums'));
const AdminAlbumDetail = lazyWithReload(() => import('./pages/AdminAlbumDetail'));
const AdminActivity = lazyWithReload(() => import('./pages/AdminActivity'));

// Loading component
const LoadingFallback = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      <p className="mt-4 text-gray-600">Loading...</p>
    </div>
  </div>
);

// Share intent handler component
const ShareIntentHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Log component mount
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/core').then(({ registerPlugin }) => {
        interface ShareHandlerPlugin {
          debugLog(options: { message: string }): Promise<void>;
        }
        const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
        ShareHandler.debugLog({ message: '[JS] ShareIntentHandler component mounted (sessionStorage check)' });
      });
    }
    
    // Check for pending share on mount and when location changes
    const checkPendingShare = () => {
      const pendingShare = sessionStorage.getItem('pendingShare');
      if (pendingShare && location.pathname !== '/share-upload') {
        try {
          const sharedFiles = JSON.parse(pendingShare);
          console.log('[ShareIntentHandler] Navigating to /share-upload with', sharedFiles.length, 'files');
          // DON'T clear sessionStorage yet - let ShareUpload do it after confirming receipt
          // Navigate to ShareUpload with file data
          navigate('/share-upload', { 
            state: { sharedFiles },
            replace: true
          });
        } catch (error) {
          console.error('[ShareIntentHandler] Failed to parse pending share:', error);
          sessionStorage.removeItem('pendingShare');
        }
      }
    };

    checkPendingShare();

    // Also listen for share events dispatched from main.tsx
    const handleShareReceived = (event: CustomEvent) => {
      if (location.pathname !== '/share-upload') {
        navigate('/share-upload', {
          state: { sharedFiles: event.detail },
          replace: true
        });
      }
    };

    // Listen for notification tap events to navigate to event album
    const handleNavigateToEvent = (event: CustomEvent) => {
      const eventSlug = event.detail?.eventSlug;
      if (eventSlug) {
        console.log('[ShareIntentHandler] Navigating to event from notification:', eventSlug);
        navigate(`/events/${eventSlug}`);
      }
    };

    // Listen for a collaboration invite link opened directly in the app
    // (photos://invite/TOKEN — see MobileAuthService.initialize())
    const handleNavigateToInvite = (event: CustomEvent) => {
      const token = event.detail?.token;
      if (token) {
        console.log('[ShareIntentHandler] Navigating to invite from deep link:', token);
        navigate(`/invite/${token}`);
      }
    };

    window.addEventListener('shareReceived', handleShareReceived as EventListener);
    window.addEventListener('navigateToEvent', handleNavigateToEvent as EventListener);
    window.addEventListener('navigateToInvite', handleNavigateToInvite as EventListener);
    
    return () => {
      window.removeEventListener('shareReceived', handleShareReceived as EventListener);
      window.removeEventListener('navigateToEvent', handleNavigateToEvent as EventListener);
      window.removeEventListener('navigateToInvite', handleNavigateToInvite as EventListener);
    };
  }, [navigate, location]);
  
  // Check native plugin for buffered share data after component mounts
  useEffect(() => {
    const isNative = Capacitor.isNativePlatform();
    
    // Always log mount, even on web
    if (isNative) {
      import('@capacitor/core').then(({ registerPlugin }) => {
        interface ShareHandlerPlugin {
          debugLog(options: { message: string }): Promise<void>;
        }
        const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
        ShareHandler.debugLog({ message: '[JS] ShareIntentHandler useEffect #2 starting - isNative: true' }).catch(e => {
          console.error('[ShareIntentHandler] debugLog failed:', e);
        });
      }).catch(e => {
        console.error('[ShareIntentHandler] Failed to load Capacitor:', e);
      });
    }
    
    if (isNative) {
      // A single fixed delay before checking for a buffered share is a guess:
      // too short and the native bridge/plugin may not be ready yet on a slow
      // cold start (share silently missed), too long and a fast device just
      // wastes time before a share the user is waiting on appears. Instead,
      // poll at increasing intervals and stop as soon as either a pending
      // share is found or we've exhausted the attempts — this adapts to
      // whatever the device's actual boot speed turns out to be.
      const RETRY_DELAYS_MS = [300, 800, 1500, 3000, 5000];
      let cancelled = false;

      const checkOnce = async (attempt: number): Promise<void> => {
        if (cancelled) return;
        try {
          const { registerPlugin } = await import('@capacitor/core');

          interface ShareHandlerPlugin {
            debugLog(options: { message: string }): Promise<void>;
            checkPendingShare(): Promise<{ hasPending: boolean; files?: Array<{ name: string; path: string; uri: string; mimeType: string; size: number }> }>;
          }

          const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
          await ShareHandler.debugLog({ message: `[JS] ShareIntentHandler checking for buffered share (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1})...` });

          const result = await ShareHandler.checkPendingShare();
          await ShareHandler.debugLog({ message: '[JS] checkPendingShare returned, hasPending: ' + result.hasPending });

          if (result.hasPending && result.files && result.files.length > 0) {
            await ShareHandler.debugLog({ message: '[JS] Found ' + result.files.length + ' buffered files, navigating to share-upload' });
            // Store in sessionStorage and trigger navigation
            sessionStorage.setItem('pendingShare', JSON.stringify(result.files));

            if (location.pathname !== '/share-upload') {
              navigate('/share-upload', {
                state: { sharedFiles: result.files },
                replace: true
              });
            }
            return; // Found it — stop retrying.
          }

          await ShareHandler.debugLog({ message: '[JS] No buffered share data found' });
        } catch (error) {
          console.error('[ShareIntentHandler] Error:', error);
          // Try to log error natively
          try {
            const { registerPlugin } = await import('@capacitor/core');
            interface ShareHandlerPlugin {
              debugLog(options: { message: string }): Promise<void>;
            }
            const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
            await ShareHandler.debugLog({ message: '[JS] ERROR in checkPendingShare: ' + String(error) });
          } catch (e) {
            // Silent fail
          }
        }

        // Schedule the next attempt (if any remain and nothing was found).
        if (attempt < RETRY_DELAYS_MS.length && !cancelled) {
          setTimeout(() => checkOnce(attempt + 1), RETRY_DELAYS_MS[attempt]);
        }
      };

      // Kick off the first (fast) attempt immediately rather than waiting for
      // the first delay — most of the time the bridge is already ready.
      checkOnce(0);

      return () => { cancelled = true; };
    }
  }, []); // Run once on mount

  return null;
};

// Page view tracker component
const PageViewTracker = () => {
  const location = useLocation();

  useEffect(() => {
    // Track page view on location change
    trackPageView(location.pathname + location.search, document.title);
  }, [location]);

  // Handle Android hardware back button
  useAndroidBackButton();

  // Dynamic status bar styling
  useStatusBar();

  return null;
};

function App() {
  // Initialize analytics on app mount
  useEffect(() => {
    initAnalytics();
  }, []);
  
  // Log App render on native platform
  if (Capacitor.isNativePlatform()) {
    import('@capacitor/core').then(({ registerPlugin }) => {
      interface ShareHandlerPlugin {
        debugLog(options: { message: string }): Promise<void>;
      }
      const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
      ShareHandler.debugLog({ message: '[JS] App component is rendering' });
    });
  }
  
  return (
    <ErrorBoundary>
    <HelmetProvider>
      <ThemeProvider>
        <AuthProvider>
          <RefreshProvider>
            <UploadProvider>
              <ToastProvider>
                <BrowserRouter>
                  <ShareIntentHandler />
                  <PageViewTracker />
                  <PullToRefresh>
                    <Suspense fallback={<LoadingFallback />}>
                      <Routes>
                      <Route path="/" element={<Landing />} />
                      <Route path="/events" element={<EventList />} />
                      <Route path="/events/:slug" element={<EventGallery />} />
                      <Route path="/p/:slug/:photoId" element={<PhotoDetail />} />
                      <Route path="/favorites" element={<MyFavorites />} />
                      <Route path="/invite/:token" element={<InviteAccept />} />
                      <Route path="/logout" element={<Logout />} />
                      <Route path="/map" element={<MapView />} />
                      <Route path="/usage" element={<PhotoUsage />} />
                      <Route path="/privacy" element={<PrivacyPolicy />} />
                      <Route path="/share-upload" element={<ShareUpload />} />
                      <Route path="/timeline" element={<Timeline />} />
                      <Route path="/cast-receiver" element={<CastReceiver />} />
                      <Route path="/search" element={<SearchPage />} />
                      <Route path="/admin/people" element={<AdminPeople />} />
                      <Route path="/admin/people/:personId" element={<AdminPersonDetail />} />
                      <Route path="/admin" element={<AdminDashboard />} />
                      <Route path="/admin/tags" element={<AdminTagManager />} />
                      <Route path="/admin/trash" element={<AdminTrash />} />
                      <Route path="/admin/duplicates" element={<AdminDuplicates />} />
                      <Route path="/admin/albums" element={<AdminAlbums />} />
                      <Route path="/admin/albums/:albumId" element={<AdminAlbumDetail />} />
                      <Route path="/admin/activity" element={<AdminActivity />} />
                      <Route path="/admin/events/:slug/photos" element={<AdminPhotoManager />} />
                    </Routes>
                    </Suspense>
                  </PullToRefresh>
                  <AndroidAppPrompt />
                  <GlobalUploadIndicator />
                  <OfflineBanner />
                </BrowserRouter>
              </ToastProvider>
            </UploadProvider>
          </RefreshProvider>
        </AuthProvider>
      </ThemeProvider>
    </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;
