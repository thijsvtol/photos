# Quick Start Guide - Photos Mobile App

This guide will help you get started with the Photos mobile app for uploading photos from your phone.

## Installation Methods

### Method 1: Using Expo Go (Easiest - No Build Required)

This is the fastest way to test the app on your physical device:

1. **Install Expo Go**:
   - iOS: Download from [App Store](https://apps.apple.com/app/expo-go/id982107779)
   - Android: Download from [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)

2. **Start the Development Server**:
   ```bash
   cd subdomains/photos/apps/mobile
   npm start
   ```

3. **Connect Your Device**:
   - **iOS**: Open your Camera app and scan the QR code
   - **Android**: Open Expo Go app and scan the QR code

### Method 2: Using iOS Simulator (macOS Only)

1. **Install Xcode** from the Mac App Store (if not already installed)

2. **Start the iOS Simulator**:
   ```bash
   cd subdomains/photos/apps/mobile
   npm run ios
   ```

### Method 3: Using Android Emulator

1. **Install Android Studio** and set up an Android Virtual Device (AVD)

2. **Start the Android Emulator**:
   ```bash
   cd subdomains/photos/apps/mobile
   npm run android
   ```

## First-Time Setup

### Step 1: Configure the App

When you first launch the app, you'll see the configuration screen:

1. **API Endpoint**: Enter your photos API URL
   - Production: `https://photos.thijsvtol.nl`
   - Local development: `http://192.168.x.x:8787` (replace with your computer's local IP)

2. **Admin Secret**: Enter your admin authentication secret
   - This is the `ADMIN_SHARED_SECRET` set in your `.dev.vars` file or production secrets

3. Tap **Save Configuration**

### Step 2: Select an Event

After configuration, you'll see a list of all events:

1. Pull down to refresh the list
2. Tap on an event to open the upload screen
3. Tap the ⚙️ icon to update your configuration

### Step 3: Upload Photos

On the upload screen:

1. Tap **📷 Select Photos** to open your photo library
2. Select one or multiple photos
3. Review the selected photos in the queue
4. Tap **⬆️ Upload** to start uploading
5. Watch the progress for each photo
6. Tap **Clear Completed** to remove successfully uploaded photos

## Using with Local Development

If you're running the photos application locally for development:

### 1. Find Your Computer's Local IP Address

**macOS/Linux**:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Windows**:
```bash
ipconfig
```

Look for your local IP address (usually something like `192.168.1.x` or `10.0.x.x`)

### 2. Ensure Worker is Running

Make sure your worker is running and accessible:

```bash
cd subdomains/photos/apps/worker
npm run dev
# Worker should be running on http://0.0.0.0:8787
```

### 3. Configure the App

In the mobile app configuration:
- **API Endpoint**: `http://192.168.x.x:8787` (use your actual IP)
- **Admin Secret**: Your `ADMIN_SHARED_SECRET` from `.dev.vars`

### 4. Test Connectivity

If you can't connect:
- Ensure your phone and computer are on the same WiFi network
- Check that your firewall isn't blocking port 8787
- Try accessing `http://192.168.x.x:8787/api/events` in your phone's browser

## Common Issues

### "Failed to load events"

**Possible causes:**
- Incorrect API endpoint
- Wrong admin secret
- API not running or not accessible
- Phone and computer on different networks (for local dev)

**Solutions:**
1. Tap ⚙️ Settings and verify your configuration
2. Check that the API is accessible from your phone's browser
3. Ensure both devices are on the same WiFi network

### "Upload failed"

**Possible causes:**
- Network connectivity issues
- Large file size
- Event doesn't exist
- Permission issues

**Solutions:**
1. Check your internet connection
2. Try uploading fewer or smaller photos
3. Verify the event exists in the admin dashboard
4. Pull down to refresh the event list

### Permissions Denied

If the app can't access your photos:

1. Go to your phone's Settings
2. Find the Expo Go app (or your built app)
3. Enable photo library access
4. Restart the app

## Tips & Tricks

### Faster Uploads
- Upload photos in smaller batches (10-20 at a time)
- Use WiFi instead of cellular data for faster uploads
- Clear completed uploads regularly

### Organizing Photos
- Create events before starting a photo session
- Use descriptive event names
- Upload photos to the correct event immediately after taking them

### Battery Life
- Keep your phone plugged in during large uploads
- The app will continue uploading even if you lock your screen

## Production Builds

To create a standalone app that can be installed without Expo Go:

### iOS (requires Apple Developer account)
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure and build
eas build --platform ios
```

### Android
```bash
# Build APK
eas build --platform android --profile preview

# Or build AAB for Play Store
eas build --platform android
```

The builds will be available in your Expo dashboard for download and distribution.

## Need Help?

- Check the full [README.md](./README.md) for detailed documentation
- Review the [main photos documentation](../README.md) for API details
- Check Expo documentation at https://docs.expo.dev/
