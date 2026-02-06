# Mobile Photo Upload App - Installation & Setup

This guide provides step-by-step instructions for setting up and using the mobile photo upload app.

## Overview

The mobile app allows you to upload photos directly from your phone to your photos gallery application. It supports both iOS and Android devices.

## Quick Links

- **Detailed Documentation**: [apps/mobile/README.md](./apps/mobile/README.md)
- **Quick Start Guide**: [apps/mobile/QUICKSTART.md](./apps/mobile/QUICKSTART.md)
- **Main Photos Documentation**: [README.md](./README.md)

## Prerequisites

- Node.js 18+ installed on your development machine
- npm or yarn package manager
- For iOS: macOS with Xcode (for simulator) OR an iOS device
- For Android: Android Studio (for emulator) OR an Android device
- Expo Go app (for testing on physical devices)

## Installation Steps

### 1. Install Dependencies

Navigate to the mobile app directory and install dependencies:

```bash
cd subdomains/photos/apps/mobile
npm install
```

### 2. Start the Development Server

Start the Expo development server:

```bash
npm start
```

This will open the Expo DevTools in your browser and display a QR code.

### 3. Run on Device or Simulator

Choose one of the following options:

#### Option A: Physical Device (Easiest)

1. Install **Expo Go** from App Store (iOS) or Play Store (Android)
2. Scan the QR code with your device's camera (iOS) or Expo Go app (Android)
3. The app will load on your device

#### Option B: iOS Simulator (macOS only)

```bash
npm run ios
```

#### Option C: Android Emulator

```bash
npm run android
```

## Configuration

### For Production Use

1. Launch the app
2. Enter the following configuration:
   - **API Endpoint**: `https://photos.thijsvtol.nl`
   - **Admin Secret**: Your admin secret (contact admin for credentials)
3. Tap **Save Configuration**

### For Local Development

If you're developing locally:

1. Find your computer's local IP address:
   ```bash
   # macOS/Linux
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Windows
   ipconfig
   ```

2. Ensure the worker is running:
   ```bash
   cd subdomains/photos/apps/worker
   npm run dev
   ```

3. Configure the app:
   - **API Endpoint**: `http://YOUR_LOCAL_IP:8787` (e.g., `http://192.168.1.100:8787`)
   - **Admin Secret**: Value from your `.dev.vars` file

4. Ensure your phone and computer are on the same WiFi network

## Using the App

### Uploading Photos

1. **Select an Event**: Choose from the list of available events
2. **Select Photos**: Tap the "📷 Select Photos" button
3. **Review Queue**: Check the selected photos in the upload queue
4. **Upload**: Tap "⬆️ Upload" to start uploading
5. **Monitor Progress**: Watch the progress bar for each photo
6. **Clear Completed**: Remove successfully uploaded photos from the queue

### Managing Configuration

- Tap the ⚙️ icon in the event selection screen to update your configuration
- Configuration is stored locally on your device

## Troubleshooting

### Cannot Connect to API

**Problem**: "Failed to load events" error

**Solutions**:
1. Verify your API endpoint is correct
2. Check that the admin secret is correct
3. For local development: Ensure phone and computer are on the same WiFi
4. Try accessing the API endpoint in your phone's browser to test connectivity

### Permission Issues

**Problem**: Cannot access photos

**Solutions**:
1. Open your device Settings
2. Find Expo Go (or your app name)
3. Enable photo library permissions
4. Restart the app

### Upload Failures

**Problem**: Photos fail to upload

**Solutions**:
1. Check your internet connection
2. Try uploading fewer photos at once
3. Verify the event still exists
4. Check the network tab for specific error messages

## Building for Production

### Create Standalone Apps

To create installable apps (not requiring Expo Go):

1. Install EAS CLI:
   ```bash
   npm install -g eas-cli
   ```

2. Login to Expo:
   ```bash
   eas login
   ```

3. Build for iOS:
   ```bash
   eas build --platform ios
   ```

4. Build for Android:
   ```bash
   eas build --platform android
   ```

### Distribution

- **iOS**: Requires Apple Developer account ($99/year)
- **Android**: Can distribute APK directly or publish to Play Store ($25 one-time fee)

## Development

### Project Structure

```
mobile/
├── App.tsx                         # Main app component
├── src/
│   ├── screens/                    # Screen components
│   │   ├── ConfigScreen.tsx
│   │   ├── EventSelectionScreen.tsx
│   │   └── PhotoUploadScreen.tsx
│   ├── utils/                      # Utilities
│   │   ├── api.ts                  # API client
│   │   ├── config.ts               # Config management
│   │   └── uploadManager.ts        # Upload logic
│   └── types/                      # TypeScript types
│       └── index.ts
├── package.json
└── README.md
```

### Making Changes

1. Edit files in `src/`
2. Save - changes will hot-reload automatically
3. Test on device or simulator
4. Run TypeScript check: `npx tsc --noEmit`

## Support

For issues or questions:

1. Check the [README](./apps/mobile/README.md) for detailed documentation
2. Review the [Quick Start Guide](./apps/mobile/QUICKSTART.md)
3. Check the main [Photos Documentation](./README.md)
4. Review Expo documentation at https://docs.expo.dev/

## Next Steps

After setting up:

1. Test uploading a few photos
2. Verify photos appear in the gallery
3. Test with different photo sizes and quantities
4. Explore batch upload capabilities
5. Consider creating a standalone build for easier access

Happy uploading! 📸
