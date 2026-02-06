import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Landing from './pages/Landing';
import EventList from './pages/EventList';
import EventGallery from './pages/EventGallery';
import PhotoDetail from './pages/PhotoDetail';
import MyFavorites from './pages/MyFavorites';
import MapView from './pages/MapView';
import PhotoUsage from './pages/PhotoUsage';
import AdminDashboard from './pages/AdminDashboard';
import AdminEventUpload from './pages/AdminEventUpload';
import AdminPhotoManager from './pages/AdminPhotoManager';
import AdminTagManager from './pages/AdminTagManager';

function App() {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/events" element={<EventList />} />
          <Route path="/events/:slug" element={<EventGallery />} />
          <Route path="/p/:slug/:photoId" element={<PhotoDetail />} />
          <Route path="/favorites" element={<MyFavorites />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/usage" element={<PhotoUsage />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/events/:slug/upload" element={<AdminEventUpload />} />
          <Route path="/admin/events/:slug/photos" element={<AdminPhotoManager />} />
          <Route path="/admin/tags" element={<AdminTagManager />} />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
}

export default App;
