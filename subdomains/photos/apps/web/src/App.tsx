import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Capacitor } from '@capacitor/core';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { RefreshProvider } from './contexts/RefreshContext';
import { ToastProvider } from './components/Toast';
import PullToRefresh from './components/PullToRefresh';
import { AndroidAppPrompt } from './components/AndroidAppPrompt';

// Lazy load route components for better code splitting
const Landing = lazy(() => import('./pages/Landing'));
const EventList = lazy(() => import('./pages/EventList'));
const EventGallery = lazy(() => import('./pages/EventGallery'));
const PhotoDetail = lazy(() => import('./pages/PhotoDetail'));
const MyFavorites = lazy(() => import('./pages/MyFavorites'));
const Logout = lazy(() => import('./pages/Logout'));
const MapView = lazy(() => import('./pages/MapView'));
const PhotoUsage = lazy(() => import('./pages/PhotoUsage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminEventUpload = lazy(() => import('./pages/AdminEventUpload'));
const AdminPhotoManager = lazy(() => import('./pages/AdminPhotoManager'));
const AdminTagManager = lazy(() => import('./pages/AdminTagManager'));
const InviteAccept = lazy(() => import('./pages/InviteAccept'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const ShareUpload = lazy(() => import('./pages/ShareUpload'));

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

    window.addEventListener('shareReceived', handleShareReceived as EventListener);
    window.addEventListener('navigateToEvent', handleNavigateToEvent as EventListener);
    
    return () => {
      window.removeEventListener('shareReceived', handleShareReceived as EventListener);
      window.removeEventListener('navigateToEvent', handleNavigateToEvent as EventListener);
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
      // Longer delay to ensure everything is ready
      setTimeout(async () => {
        try {
          const { registerPlugin } = await import('@capacitor/core');
          
          interface ShareHandlerPlugin {
            debugLog(options: { message: string }): Promise<void>;
            checkPendingShare(): Promise<{ hasPending: boolean; files?: Array<{ name: string; path: string; uri: string; mimeType: string; size: number }> }>;
          }
          
          const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
          await ShareHandler.debugLog({ message: '[JS] ShareIntentHandler mounted, checking for buffered share...' });
          
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
          } else {
            await ShareHandler.debugLog({ message: '[JS] No buffered share data found' });
          }
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
      }, 5000); // Wait 5 seconds to ensure WebView fully loads
    }
  }, []); // Run once on mount

  return null;
};

function App() {
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
    <HelmetProvider>
      <ThemeProvider>
        <AuthProvider>
          <RefreshProvider>
            <ToastProvider>
              <BrowserRouter>
                <ShareIntentHandler />
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
                      <Route path="/admin" element={<AdminDashboard />} />
                      <Route path="/admin/events/:slug/upload" element={<AdminEventUpload />} />
                      <Route path="/admin/events/:slug/photos" element={<AdminPhotoManager />} />
                      <Route path="/admin/tags" element={<AdminTagManager />} />
                    </Routes>
                  </Suspense>
                </PullToRefresh>
                <AndroidAppPrompt />
              </BrowserRouter>
            </ToastProvider>
          </RefreshProvider>
        </AuthProvider>
      </ThemeProvider>
    </HelmetProvider>
  );
}

export default App;
