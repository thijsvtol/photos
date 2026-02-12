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
  
  folderSyncService.initialize().then(() => {
    // Auto-sync configured folders on app launch
    folderSyncService.syncAllFolders().then((count) => {
      if (count > 0) {
        console.log(`Folder sync: ${count} new files queued for upload`);
      }
    }).catch((err) => {
      console.warn('Folder auto-sync on startup failed:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
