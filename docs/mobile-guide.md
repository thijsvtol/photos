# Mobile App (Android)

This folder contains the Capacitor-powered mobile app for the Photos application. It wraps the
existing React web app and adds native capabilities like background sync and folder access.

> **Platform status**: Only `apps/android/` is currently checked into this repository and released
> (see [android-deployment.md](android-deployment.md) and the CHANGELOG for Android build history).
> There is no `apps/ios/` project. The web app itself works fine in iOS Safari, and Capacitor is
> cross-platform, so the iOS instructions below are kept as a reference for anyone who wants to run
> `npx cap add ios` and package an iOS build themselves — but iOS is not built, tested, or
> distributed by this project today.

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

### For Android Development (supported today)

- Android Studio installed
- Android SDK & Emulator setup
- Physical Android device (optional)

### For iOS Development (not currently packaged - see platform status note above)

- macOS with Xcode 14+ installed
- iOS Simulator or physical iOS device
- Apple Developer account (for device testing & App Store)
- Requires first running `npx cap add ios` from `apps/web` to generate the missing iOS project

## Development Setup

### 1. Install Dependencies

```bash
cd apps/web
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

> Run Capacitor commands from `apps/web` (not from repo root with `--prefix`) so platform resolution works correctly.

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

- Bundle ID: `com.yourcompany.photos` (configure in Xcode)
- App name: "Photos" (or your app name)
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

- Application ID: `com.yourcompany.photos` (configure in build.gradle)
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

### iOS Background Sync Behavior

- Uses `BackgroundTasks` framework
- Periodic sync every 15 minutes (when app in background)
- OS decides when to run based on usage patterns
- Can sync up to ~30 seconds per task

### Android Background Sync Behavior

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

Folder sync lets a user point a folder (e.g. the camera roll) at an event; new photos in it are
uploaded automatically. On Android it runs as a **native background engine**, not in the WebView.

### How to Use

1. Open event upload page in mobile app
2. Tap "Select Folder" in the Folder Sync section
3. Grant storage permissions
4. Select folder to sync
5. New photos are uploaded automatically, including when the app is closed

### Architecture

The engine lives in `apps/android/app/src/main/java/nl/thijsvtol/photos/sync/` and runs in a
WorkManager job. The web layer only stores configuration and hands it down.

| Piece | Role |
| --- | --- |
| `SyncScheduler` | Periodic `PeriodicWorkRequest` (default hourly) + one-shot "sync now" runs, all under one unique work name |
| `FolderSyncWorker` | The run itself: scan → hash → dedupe → upload, as a `dataSync` foreground service |
| `SafScanner` | Recursive `DocumentsContract` walk of a SAF tree URI (also backs `SafDirectoryPlugin.listFiles`) |
| `MediaProbe` | Streaming SHA-256, subsampled preview JPEG, EXIF — never holds a whole file |
| `PhotosApiClient` | OkHttp client for the same `/uploads/*` endpoints the web app uses; part bodies stream off the `content://` URI |
| `SyncLedger` | SQLite record of every file seen — both the dedupe history and the durable upload queue |
| `SyncNotifier` | Progress + summary notifications, with a "Pause sync" action |
| `FolderSyncPlugin` | Capacitor bridge: `configure`, `syncNow`, `getStatus`, `retryFailed`, `resetLedger`, face-job handoff |

Why native: the previous JS implementation used `BackgroundTask.beforeExit`, a one-shot grant that
was never re-registered, so it ran at most once per launch and never with the app swiped away.

### Duplicate detection

A file is never uploaded twice, even after reassigning or re-adding a folder. Two independent keys:

- **Cheap identity** — `(event, SAF document id, size, mtime)`. Survives re-picking the folder.
- **Content hash** — SHA-256, matching `computeFileHash()` on web so duplicates group correctly.

If the local ledger doesn't know a hash, the engine asks the server via
`POST /api/admin/events/:slug/uploads/check-hashes`, which reports which hashes the event already
has a completed, non-deleted photo for. That is what makes sync survive a reinstall, cleared app
data, or the same folder synced from a second device.

`FolderSyncConfig.lastSyncTime` is deprecated and unused. It was the *only* dedupe signal before,
and because adding a folder reset it, every re-add re-uploaded the whole folder.

### Memory and crash behaviour

Peak memory is independent of file size and batch size — nothing ever buffers a whole file:

- hashing streams through a 64 KB buffer;
- previews decode with `inSampleSize`, so a 108MP photo never allocates a full-res bitmap;
- upload parts stream a byte range straight from the `content://` URI into the socket.

Multipart resume state (`upload_id` + part ETags) is committed to the ledger as each part lands. If
the process dies, the next run sweeps rows stuck in `uploading` back into the queue **with** that
state, so a part-uploaded large video continues rather than restarting. That sweep increments the
row's retry counter, so a file that reproducibly kills the process is quarantined after
`MAX_RETRIES` instead of poisoning every future run. Quarantined files are listed in the folder
sync UI with a per-file retry.

Each run is capped (~9 minutes / 200 files) and chains a continuation if a backlog remains, so a
several-thousand-photo backlog drains across runs rather than one run being killed for overrunning.

### Settings

Configurable per-device in the Folder Sync section, enforced by WorkManager constraints:

- **Sync in the background** — master switch (also flipped off by the notification's "Pause sync")
- **Wi-Fi only** — default on; uses `NetworkType.UNMETERED`
- **Skip when battery is low** — default on
- **Interval** — 15 min to daily, default hourly

Folders are also scanned on app launch and on resume.

### Face detection

Face embeddings need the WASM model, which only exists in the WebView. Natively uploaded photos are
parked in the ledger (`faces_pending`) and drained by `faceDetectionQueue.ts` the next time the app
is open, decoding via `SafDirectory.readPreview()`.

See `apps/web/src/services/folderSync.ts` (configuration) and the `sync/` package (engine).

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

If Android build fails in a Capacitor plugin with `proguard-android.txt is no longer supported`, this project uses `patch-package` to apply a persistent fix for `@capacitor/haptics` after install.

```bash
# Re-apply all patches manually (also runs automatically on npm install)
npx patch-package
```

## File Structure

```text
apps/
├── web/                         # Web app (React + Vite)
│   ├── src/
│   │   ├── services/
│   │   │   ├── backgroundSync.ts    # Manual/share upload background service
│   │   │   ├── folderSync.ts        # Folder sync configuration (engine is native)
│   │   │   └── folderSyncPlugin.ts  # Bridge to the native sync engine
│   │   ├── components/
│   │   │   └── FolderSyncManager.tsx # Folder sync UI + settings
│   │   └── main.tsx                 # Capacitor initialization
│   ├── capacitor.config.ts          # Capacitor configuration
│   └── package.json
│
└── android/                     # Android native project
    ├── app/
    │   ├── src/
    │   │   └── main/
    │   │       ├── AndroidManifest.xml
    │   │       ├── assets/           # Web assets (synced from web/dist)
    │   │       └── java/
    │   └── build.gradle
    ├── build.gradle
    ├── settings.gradle
    └── gradlew
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
