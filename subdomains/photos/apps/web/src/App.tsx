import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import EventList from './pages/EventList';
import EventGallery from './pages/EventGallery';
import PhotoDetail from './pages/PhotoDetail';
import MyFavorites from './pages/MyFavorites';
import MapView from './pages/MapView';
import AdminDashboard from './pages/AdminDashboard';
import AdminEventUpload from './pages/AdminEventUpload';
import AdminPhotoManager from './pages/AdminPhotoManager';
import AdminTagManager from './pages/AdminTagManager';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/events" element={<EventList />} />
        <Route path="/events/:slug" element={<EventGallery />} />
        <Route path="/p/:slug/:photoId" element={<PhotoDetail />} />
        <Route path="/favorites" element={<MyFavorites />} />
        <Route path="/map" element={<MapView />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/events/:slug/upload" element={<AdminEventUpload />} />
        <Route path="/admin/events/:slug/photos" element={<AdminPhotoManager />} />
        <Route path="/admin/tags" element={<AdminTagManager />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
