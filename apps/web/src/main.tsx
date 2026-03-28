import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import App from './App';
import './index.css';
import { backgroundSyncService } from './services/backgroundSync';
import { folderSyncService } from './services/folderSync';
import { MobileAuthService } from './services/mobileAuth';

// CRITICAL: Log immediately to verify JavaScript executes
console.log('[MAIN.TSX] ===== JavaScript bundle executing =====');
console.log('[MAIN.TSX] isNativePlatform:', Capacitor.isNativePlatform());

// Initialize mobile services
if (Capacitor.isNativePlatform()) {
  console.log('[main.tsx] Running on native platform, initializing services...');
  
  // Add native logging
  import('@capacitor/core').then(async ({ registerPlugin }) => {
    interface ShareHandlerPlugin {
      debugLog(options: { message: string }): Promise<void>;
    }
    const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
    await ShareHandler.debugLog({ message: '[JS] main.tsx executing - native platform detected' });
  });
  
  // Initialize OAuth deep link handling
  MobileAuthService.initialize();
  
  backgroundSyncService.initialize().then(() => {
    backgroundSyncService.startBackgroundSync();
    
    // Listen for notification actions (taps)
    LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
      console.log('[Notification] Action performed:', notification);
      
      const eventSlug = notification.notification.extra?.eventSlug;
      const action = notification.notification.extra?.action;
      
      if (action === 'view_event' && eventSlug) {
        console.log('[Notification] Navigating to event:', eventSlug);
        // Navigate to the event by dispatching a custom event
        window.dispatchEvent(new CustomEvent('navigateToEvent', { 
          detail: { eventSlug } 
        }));
      }
    });
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

  // Initialize share intent handling
  // Note: The actual check for pending shares happens in App.tsx after React mounts
  console.log('[main.tsx] Starting share handler initialization...');
  
  import('@capacitor/core').then(async ({ registerPlugin }) => {
    console.log('[ShareHandler] Module loaded, registering plugin...');
    
    interface ShareHandlerPlugin {
      addListener(eventName: 'shareReceived', listenerFunc: (data: { files: Array<{ name: string; path: string; uri: string; mimeType: string; size: number }> }) => void): Promise<any>;
      addListener(eventName: 'shareError', listenerFunc: (data: { error: string }) => void): Promise<any>;
    }
    
    const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
    
    console.log('[ShareHandler] Plugin registered, adding listeners...');
    
    // Listen for share events from native layer (for future shares while app is running)
    await ShareHandler.addListener('shareReceived', (data: { files: Array<{ name: string; path: string; uri: string; mimeType: string; size: number }> }) => {
      console.log('[ShareHandler] Share received with', data.files.length, 'files:', data.files);
      handleShareReceived(data.files);
    });

    await ShareHandler.addListener('shareError', (data: { error: string }) => {
      console.error('[ShareHandler] Share error:', data.error);
    });
    
    console.log('[ShareHandler] Event listeners registered successfully');
  }).catch(err => {
    console.error('[ShareHandler] Failed to initialize:', err);
  });
} else {
  console.log('[main.tsx] Running on web platform');
}

// Helper function to handle received share data
function handleShareReceived(files: Array<{ name: string; path: string; uri: string; mimeType: string; size: number }>) {
  console.log('[ShareHandler] Processing', files.length, 'shared files');
  
  // Store shared files in sessionStorage so App component can handle navigation
  sessionStorage.setItem('pendingShare', JSON.stringify(files));
  console.log('[ShareHandler] Stored in sessionStorage');
  
  // Trigger a custom event to notify the app
  window.dispatchEvent(new CustomEvent('shareReceived', { detail: files }));
  console.log('[ShareHandler] Dispatched shareReceived event');
}

// Log before React renders
if (Capacitor.isNativePlatform()) {
  import('@capacitor/core').then(async ({ registerPlugin }) => {
    interface ShareHandlerPlugin {
      debugLog(options: { message: string }): Promise<void>;
    }
    const ShareHandler = registerPlugin<ShareHandlerPlugin>('ShareHandler');
    await ShareHandler.debugLog({ message: '[JS] main.tsx about to render React app' });
  });
}

// Suppress Filerobot's harmless internal tab communication error
// This error occurs when Filerobot tries to communicate with a non-existent tabs system
// in web environments, but doesn't affect functionality
window.addEventListener('error', (event) => {
  if (event.message?.includes('No Listener: tabs:outgoing.message.ready')) {
    event.preventDefault();
    return;
  }
});

// Also suppress unhandled promise rejections for the same error
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('No Listener: tabs:outgoing.message.ready')) {
    event.preventDefault();
    return;
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
