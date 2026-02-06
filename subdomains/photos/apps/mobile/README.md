# Photos Mobile App

A React Native mobile app for uploading photos directly from your phone to the photos.thijsvtol.nl photo gallery application.

## Features

- 📱 **Mobile Photo Upload**: Select and upload photos directly from your phone's camera roll
- 🔐 **Admin Authentication**: Secure admin access with API secret
- 📂 **Event Selection**: Choose which event to upload photos to
- 📊 **Upload Progress**: Real-time progress tracking for each photo
- 🔄 **Batch Upload**: Upload multiple photos at once
- 📷 **EXIF Preservation**: Automatically extracts and preserves photo metadata (camera, lens, GPS, etc.)
- 💾 **Queue Management**: Add photos to a queue before uploading
- ✅ **Upload Status**: Track pending, uploading, completed, and failed photos

## Tech Stack

- **React Native** with **Expo** for cross-platform mobile development
- **TypeScript** for type safety
- **expo-image-picker** for accessing device photos
- **expo-media-library** for photo library permissions
- **expo-file-system** for file operations
- **@react-native-async-storage/async-storage** for local configuration storage
- **axios** for API communication

## Prerequisites

- Node.js 18+ and npm
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator (macOS only) or Android Studio (for Android emulator)
- Expo Go app on your physical device (alternative to simulators)

## Installation

1. **Install dependencies**:
   ```bash
   cd subdomains/photos/apps/mobile
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm start
   ```

3. **Run on your device or simulator**:
   - **iOS Simulator** (macOS only): Press `i` in the terminal or run `npm run ios`
   - **Android Emulator**: Press `a` in the terminal or run `npm run android`
   - **Physical Device**: Scan the QR code with Expo Go app (iOS/Android)

## Configuration

When you first launch the app, you'll need to configure:

1. **API Endpoint**: The URL of your photos application (e.g., `https://photos.thijsvtol.nl`)
2. **Admin Secret**: Your admin authentication secret (set in the worker's environment variables)

This configuration is stored locally on your device and persists across app restarts.

## Usage

### First Time Setup

1. Launch the app
2. Enter your API endpoint and admin secret
3. Tap "Save Configuration"

### Uploading Photos

1. Select an event from the list
2. Tap "📷 Select Photos" to choose photos from your camera roll
3. Review the selected photos in the upload queue
4. Tap "⬆️ Upload" to start uploading
5. Monitor the progress of each upload
6. Completed uploads can be cleared with "Clear Completed"

### Managing Configuration

- Tap the ⚙️ Settings icon on the event selection screen to update your configuration
- You can change the API endpoint or admin secret at any time

## How It Works

### Photo Upload Flow

1. **Photo Selection**: User selects photos using the native image picker
2. **Metadata Extraction**: EXIF data (camera, lens, GPS, date, etc.) is extracted from each photo
3. **Multipart Upload**: Large photos are split into 5MB chunks and uploaded in parts
4. **Progress Tracking**: Each chunk upload updates the progress bar
5. **Completion**: Once all parts are uploaded, the photo is marked as completed on the server

### API Integration

The app communicates with the photos application's admin API:

- `GET /api/events` - Fetch list of events
- `POST /api/admin/events/:slug/uploads/start` - Start multipart upload
- `PUT /api/admin/events/:slug/uploads/:photoId/parts/:partNumber` - Upload a part
- `POST /api/admin/events/:slug/uploads/:photoId/complete` - Complete upload

All requests include the `X-Admin-Secret` header for authentication.

## Project Structure

```
mobile/
├── App.tsx                    # Main app component
├── src/
│   ├── screens/
│   │   ├── ConfigScreen.tsx          # Configuration screen
│   │   ├── EventSelectionScreen.tsx  # Event selection screen
│   │   └── PhotoUploadScreen.tsx     # Photo upload screen
│   ├── utils/
│   │   ├── api.ts                    # API client
│   │   ├── config.ts                 # Configuration management
│   │   └── uploadManager.ts          # Upload logic
│   └── types/
│       └── index.ts                  # TypeScript types
├── package.json
└── README.md
```

## Development

### Running on Physical Device

The easiest way to test on a physical device is using Expo Go:

1. Install Expo Go from App Store (iOS) or Play Store (Android)
2. Run `npm start` in the mobile directory
3. Scan the QR code with your device's camera (iOS) or Expo Go app (Android)

### Building for Production

To create a standalone app:

**iOS:**
```bash
eas build --platform ios
```

**Android:**
```bash
eas build --platform android
```

Note: You'll need an Expo account and to configure `eas.json` for production builds.

## Permissions

The app requires the following permissions:

- **Camera Roll Access**: To select photos for upload
- **Camera Access**: For future camera integration (currently requested but not used)

These permissions are requested when first launching the app or when attempting to select photos.

## Troubleshooting

### "Failed to load events" Error

- Check that your API endpoint is correct and accessible
- Verify that your admin secret is correct
- Ensure the photos application backend is running
- Check network connectivity

### Upload Failures

- Ensure photos are valid JPEG images
- Check that the event exists and is accessible
- Verify network connectivity
- Check file sizes (very large files may time out)

### Configuration Not Saving

- Check that the app has permission to write to local storage
- Try clearing the app's data and reconfiguring

## Future Enhancements

- [ ] Camera integration for taking photos directly in the app
- [ ] Offline queue with automatic retry
- [ ] Background upload support
- [ ] Photo preview generation on device
- [ ] Upload statistics and history
- [ ] Push notifications for upload completion
- [ ] Dark mode support

## License

Proprietary - Thijs van Tol
