import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';

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

// Loading component
const LoadingFallback = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      <p className="mt-4 text-gray-600">Loading...</p>
    </div>
  </div>
);

function App() {
  return (
    <HelmetProvider>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
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
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/events/:slug/upload" element={<AdminEventUpload />} />
              <Route path="/admin/events/:slug/photos" element={<AdminPhotoManager />} />
              <Route path="/admin/tags" element={<AdminTagManager />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
      </ThemeProvider>
    </HelmetProvider>
  );
}

export default App;
