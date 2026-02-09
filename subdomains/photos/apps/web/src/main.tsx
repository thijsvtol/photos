import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import './index.css';
import { backgroundSyncService } from './services/backgroundSync';
import { folderSyncService } from './services/folderSync';
import { MobileAuthService } from './services/mobileAuth';

// Initialize mobile services
if (Capacitor.isNativePlatform()) {
  // Initialize OAuth deep link handling
  MobileAuthService.initialize();
  
  backgroundSyncService.initialize().then(() => {
    backgroundSyncService.startBackgroundSync();
  });
  
  folderSyncService.initialize();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
