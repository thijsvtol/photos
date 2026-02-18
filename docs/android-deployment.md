# Android Deployment Setup Guide

This guide will help you set up automated Android app deployment to Google Play Store via GitHub Actions.

## Prerequisites

- Google Play Console developer account ($25 one-time fee)
- Access to Google Cloud Console
- GitHub repository admin access

## Step 1: Generate Android Keystore

The keystore is used to sign your app releases. Keep it secure!

```bash
cd ~/
keytool -genkey -v \
  -keystore photos-release-key.keystore \
  -alias photos \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# You'll be prompted for:
# - Keystore password (remember this!)
# - Key password (can be same as keystore password)
# - Your name, organization, etc.
```

**Important**: 
- Back up this keystore file securely (e.g., password manager, encrypted storage)
- If you lose it, you cannot update your app on Play Store!
- Never commit it to git

Convert keystore to base64 for GitHub secrets:

```bash
cat ~/photos-release-key.keystore | base64 | pbcopy  # macOS
# or
cat ~/photos-release-key.keystore | base64 -w 0      # Linux
```

## Step 2: Set Up Google Play Console API

### 2.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project: "Photos App Deployment"
3. Enable **Google Play Android Developer API**:
   - Search for "Google Play Android Developer API"
   - Click "Enable"

### 2.2 Create Service Account

1. Go to **IAM & Admin** > **Service Accounts**
2. Click **Create Service Account**
   - Name: `github-actions-play-deploy`
   - Description: "Service account for GitHub Actions to deploy to Play Store"
3. Click **Create and Continue**
4. Skip granting additional roles (we'll do this in Play Console)
5. Click **Done**
6. Click on the service account you just created
7. Go to **Keys** tab
8. Click **Add Key** > **Create new key**
9. Select **JSON** format
10. Download the JSON file (save it securely!)

### 2.3 Link Service Account to Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Navigate to **Settings** (gear icon) > **API access**
3. Click **Link** next to your service account
4. Grant permissions:
   - Check **Admin (all permissions)** or at minimum:
   - ✅ View app information and download bulk reports
   - ✅ Create and edit draft apps
   - ✅ Release to production, exclude devices, and use app signing
   - ✅ Manage testing tracks
5. Click **Apply**

## Step 3: Update Android Build Configuration

Update `apps/android/app/build.gradle`:

**Change the versionName from "1.0" to "1.0.0"** and **add signing configuration**:

```groovy
android {
    namespace = "nl.thijsvtol.photos"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "nl.thijsvtol.photos"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"  // ← Changed from "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
        aaptOptions {
            ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~'
        }
    }
    
    // ← Add this signingConfigs block
    signingConfigs {
        release {
            if (System.getenv("RELEASE_KEYSTORE_FILE")) {
                storeFile file(System.getenv("RELEASE_KEYSTORE_FILE"))
                storePassword System.getenv("RELEASE_KEYSTORE_PASSWORD")
                keyAlias System.getenv("RELEASE_KEY_ALIAS")
                keyPassword System.getenv("RELEASE_KEY_PASSWORD")
            }
        }
    }
    
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
            signingConfig signingConfigs.release  // ← Add this line
        }
    }
}
```

## Step 4: Configure GitHub Secrets

Go to your GitHub repository:
**Settings** > **Secrets and variables** > **Actions** > **New repository secret**

Add these secrets:

### ANDROID_KEYSTORE_BASE64
The base64-encoded keystore from Step 1

### ANDROID_KEYSTORE_PASSWORD
The password you used when creating the keystore

### ANDROID_KEY_ALIAS  
The alias you used (e.g., `photos`)

### ANDROID_KEY_PASSWORD
The key password (often same as keystore password)

### GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
The entire contents of the service account JSON file from Step 2.2
(Open the file and copy-paste all the JSON)

## Step 5: First Deployment

### 5.1 Manual Initial Upload

Before GitHub Actions can deploy, you need to manually upload the first version:

```bash
# Build web app
cd apps/web
npm run build
npx cap sync android

# Navigate to Android project
cd ../android

# Open in Android Studio
npx cap open android
```

In Android Studio:
1. **Build** > **Generate Signed Bundle / APK**
2. Select **Android App Bundle**
3. Use your keystore from Step 1
4. Build for release
5. Upload the AAB to Play Console manually:
   - Go to Play Console
   - Create new app if needed
   - Go to **Production** > **Create new release**
   - Upload the AAB file
   - Fill in release details
   - Save as draft (don't publish yet)

### 5.2 Test GitHub Actions Deployment

1. Go to your GitHub repository
2. Click **Actions** tab
3. Select **Android - Build and Deploy to Play Store**
4. Click **Run workflow**
5. Select:
   - Track: **internal** (safest for testing)
   - Bump version: **true**
6. Click **Run workflow**
7. Monitor the build

If successful, check Play Console for the new internal release!

## Step 6: Regular Deployment Workflow

### Deploy to Internal Testing
1. Go to GitHub **Actions** tab
2. Run workflow with track: **internal**
3. Test thoroughly

### Promote to Beta
1. Test in internal track
2. Run workflow with track: **beta**
3. Get feedback from beta testers

### Release to Production
1. Ensure beta testing is complete
2. Run workflow with track: **production**
3. App will be reviewed by Google (1-7 days)

## Version Management

### Automatic Version Bumping
When running the workflow, set "Bump version code" to `true` to automatically increment the build number.

### Manual Version Bumping
```bash
cd apps/android/app

# Bump patch version (1.0.0 → 1.0.1)
../../../scripts/bump-version.sh patch

# Bump minor version (1.0.0 → 1.1.0)
../../../scripts/bump-version.sh minor

# Bump major version (1.0.0 → 2.0.0)
../../../scripts/bump-version.sh major

# Just bump version code
../../../scripts/bump-version.sh
```

## Troubleshooting

### "Package not found" error
- Ensure you've manually uploaded the first version
- Check that package name matches: `nl.thijsvtol.photos`

### "Keystore error"
- Verify all keystore secrets are set correctly in GitHub
- Ensure ANDROID_KEYSTORE_BASE64 is valid base64

### "Service account does not have permission"
- Check Play Console API access settings
- Ensure service account has "Release to production" permission

### Build fails
- Check workflow logs in GitHub Actions
- Verify Node.js and Java versions
- Do not hardcode `org.gradle.java.home` to a local absolute path; use CI `setup-java` / `JAVA_HOME`
- Try building locally first

## Security Best Practices

1. **Never** commit keystore files to git
2. **Always** back up your keystore securely
3. **Rotate** service account keys periodically
4. **Use** internal/alpha tracks for testing before production
5. **Monitor** Play Console for automated security alerts

## Files Created

The following files have been created for Android deployment:

- `.github/workflows/android-deploy.yml` - GitHub Actions workflow
- `scripts/bump-version.sh` - Version management script (executable)
- `android-deployment.md` - This setup guide

## Next Steps

1. ✅ **Update build.gradle** - Add signing configuration (see Step 3)
2. **Generate keystore** - Follow Step 1
3. **Set up Google Play Console API** - Follow Step 2
4. **Configure GitHub secrets** - Follow Step 4
5. **Do first manual upload** - Follow Step 5.1
6. **Test GitHub Action** - Follow Step 5.2

## Additional Resources

- [Google Play Console Help](https://support.google.com/googleplay/android-developer)
- [Android App Signing](https://developer.android.com/studio/publish/app-signing)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Capacitor Android Documentation](https://capacitorjs.com/docs/android)
