# Mobile App (iOS & Android)

This folder contains the Capacitor-powered mobile app for the Photos application. It wraps the existing React web app and adds native capabilities like background sync and folder access.

## Features

### Mobile-Specific Features
- **Background Upload Sync**: Photos continue uploading even when the app is closed
- **Folder Sync**: Automatically sync entire folders (like Camera Roll) to events
- **Local Notifications**: Get notified when uploads complete
- **Offline Queue**: Photos are queued and uploaded when connection is available
- **Network Detection**: Automatically pauses/resumes uploads based on connectivity

### Shared Features (Web + Mobile)
All existing web features work on mobile, including:
- Event galleries
- Photo uploads with drag & drop
- EXIF metadata extraction
- Favorites
- Map view
- Admin dashboard

## Prerequisites

### For iOS Development
- macOS with Xcode 14+ installed
- iOS Simulator or physical iOS device
- Apple Developer account (for device testing & App Store)

### For Android Development
- Android Studio installed
- Android SDK & Emulator setup
- Physical Android device (optional)

## Development Setup

### 1. Install Dependencies
```bash
cd subdomains/photos/apps/web
npm install
```

### 2. Build Web App
```bash
npm run build
```

### 3. Sync to Native Platforms
```bash
npx cap sync
```

This copies the web build to iOS and Android folders and updates native dependencies.

## Running the Apps

### iOS
```bash
# Open in Xcode
npx cap open ios

# Then click Run button in Xcode (⌘R)
```

**Testing on Device:**
1. Connect iPhone via USB
2. Select your device in Xcode
3. Trust the developer certificate on device
4. Click Run

### Android
```bash
# Open in Android Studio
npx cap open android

# Then click Run button in Android Studio (Shift+F10)
```

**Testing on Device:**
1. Enable Developer Mode on Android device
2. Enable USB Debugging
3. Connect device via USB
4. Select device in Android Studio
5. Click Run

## Building for Production

### iOS (App Store)
```bash
# 1. Open in Xcode
npx cap open ios

# 2. In Xcode:
#    - Product > Archive
#    - Upload to App Store Connect
#    - Submit for review
```

**Required Setup:**
- Bundle ID: `nl.thijsvtol.photos`
- App name: "Photos"
- Version & build number
- App icons (1024x1024 for store)
- Screenshots for all device sizes
- Privacy policy URL
- App Store description

**Permissions Needed in Info.plist:**
```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>Access photos to upload to your events</string>
<key>NSCameraUsageDescription</key>
<string>Take photos to upload to events</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Add location data to your photos</string>
```

### Android (Play Store)
```bash
# 1. Open in Android Studio
npx cap open android

# 2. In Android Studio:
#    - Build > Generate Signed Bundle/APK
#    - Follow signing wizard
#    - Upload AAB to Play Console
```

**Required Setup:**
- Application ID: `nl.thijsvtol.photos`
- Version code & name in `build.gradle`
- Signing key (create with keytool)
- App icons (various sizes)
- Feature graphic & screenshots
- Privacy policy URL
- Play Store listing

**Permissions Needed in AndroidManifest.xml:**
```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"/>
<uses-permission android:name="android.permission.CAMERA"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.INTERNET"/>
```

## Background Sync How It Works

### iOS
- Uses `BackgroundTasks` framework
- Periodic sync every 15 minutes (when app in background)
- OS decides when to run based on usage patterns
- Can sync up to ~30 seconds per task

### Android
- Uses `WorkManager` for background tasks
- More reliable than iOS
- Can run longer background tasks
- Battery optimization aware

### Implementation
See `src/services/backgroundSync.ts` for the sync logic:
1. Checks network connectivity
2. Retrieves pending uploads from IndexedDB queue
3. Uploads photos in chunks
4. Shows notification on completion
5. Handles errors and retries

## Folder Sync

The folder sync feature allows users to select a folder (e.g., Camera Roll) and automatically upload new photos to a specific event.

### How to Use
1. Open event upload page in mobile app
2. Tap "Add Folder" in Folder Sync section
3. Grant storage permissions
4. Select folder to sync
5. New photos auto-detected and queued

### Technical Details
- Folder configurations stored in localStorage
- Last sync timestamp tracked per folder
- Only new photos (based on modification time) are queued
- Supports JPEG, PNG, HEIC, MP4, MOV

See `src/services/folderSync.ts` for implementation.

## Development Workflow

### Making Changes
1. Edit React code in `src/`
2. Build: `npm run build`
3. Sync: `npx cap sync`
4. Test in Xcode/Android Studio

### Hot Reload (Web)
For faster development, use web version:
```bash
npm run dev
# Mobile features won't work but UI can be tested
```

### Live Reload (Native)
Use Capacitor's live reload for native testing:
```bash
# Start dev server
npm run dev

# Update capacitor.config.ts with your local IP:
# server: { url: 'http://192.168.1.x:5173' }

# Then open in native IDE
npx cap sync
npx cap open ios  # or android
```

## Troubleshooting

### Build Errors
```bash
# Clear build cache
rm -rf dist/
npm run build
npx cap sync
```

### iOS Issues
- **"Developer cannot be verified"**: Settings > General > VPN & Device Management
- **"No provisioning profiles"**: Add Apple ID in Xcode preferences
- **Background tasks not working**: Check Background Modes in Xcode capabilities

### Android Issues
- **Gradle sync failed**: Update Android Studio & Gradle
- **App crashes on start**: Check Logcat for errors
- **Permissions denied**: Check AndroidManifest.xml

### Plugin Issues
```bash
# Reinstall Capacitor plugins
npm install @capacitor/core @capacitor/filesystem @capacitor/local-notifications @capacitor/network @capawesome/capacitor-background-task
npx cap sync
```

## File Structure

```
subdomains/photos/apps/web/
├── src/
│   ├── services/
│   │   ├── backgroundSync.ts    # Background upload service
│   │   └── folderSync.ts        # Folder sync service
│   ├── components/
│   │   └── FolderSyncManager.tsx # Folder sync UI
│   └── main.tsx                 # Capacitor initialization
├── ios/                         # iOS native project
├── android/                     # Android native project
├── capacitor.config.ts          # Capacitor configuration
└── package.json
```

## Resources

- [Capacitor Docs](https://capacitorjs.com/docs)
- [Background Task Plugin](https://capawesome.io/plugins/background-task/)
- [iOS Background Tasks](https://developer.apple.com/documentation/backgroundtasks)
- [Android WorkManager](https://developer.android.com/topic/libraries/architecture/workmanager)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Capacitor plugin documentation
3. Check native platform logs (Xcode Console / Android Logcat)
