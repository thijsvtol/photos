import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import EventList from './pages/EventList';
import EventGallery from './pages/EventGallery';
import PhotoDetail from './pages/PhotoDetail';
import AdminDashboard from './pages/AdminDashboard';
import AdminEventUpload from './pages/AdminEventUpload';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/events" replace />} />
        <Route path="/events" element={<EventList />} />
        <Route path="/events/:slug" element={<EventGallery />} />
        <Route path="/p/:slug/:photoId" element={<PhotoDetail />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/events/:slug/upload" element={<AdminEventUpload />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
