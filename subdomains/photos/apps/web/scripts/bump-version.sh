#!/bin/bash

# Script to manually bump Android version
# Usage: ./scripts/bump-version.sh [patch|minor|major]

set -e

cd "$(dirname "$0")/../android/app"

# Read current version
CURRENT_VERSION_CODE=$(grep "versionCode" build.gradle | awk '{print $2}')
CURRENT_VERSION_NAME=$(grep "versionName" build.gradle | awk '{print $2}' | tr -d '"')

echo "Current version: $CURRENT_VERSION_NAME (Build $CURRENT_VERSION_CODE)"

# Increment version code
NEW_VERSION_CODE=$((CURRENT_VERSION_CODE + 1))

# Handle version name bump
if [ "$1" = "major" ]; then
    IFS='.' read -ra PARTS <<< "$CURRENT_VERSION_NAME"
    NEW_VERSION_NAME="$((PARTS[0] + 1)).0.0"
elif [ "$1" = "minor" ]; then
    IFS='.' read -ra PARTS <<< "$CURRENT_VERSION_NAME"
    NEW_VERSION_NAME="${PARTS[0]}.$((PARTS[1] + 1)).0"
elif [ "$1" = "patch" ]; then
    IFS='.' read -ra PARTS <<< "$CURRENT_VERSION_NAME"
    NEW_VERSION_NAME="${PARTS[0]}.${PARTS[1]}.$((PARTS[2] + 1))"
else
    # Just bump version code, keep version name
    NEW_VERSION_NAME=$CURRENT_VERSION_NAME
fi

echo "New version: $NEW_VERSION_NAME (Build $NEW_VERSION_CODE)"

# Update build.gradle
sed -i.bak "s/versionCode $CURRENT_VERSION_CODE/versionCode $NEW_VERSION_CODE/" build.gradle
sed -i.bak "s/versionName \"$CURRENT_VERSION_NAME\"/versionName \"$NEW_VERSION_NAME\"/" build.gradle
rm build.gradle.bak

echo "✅ Version updated!"
echo "  Version Name: $CURRENT_VERSION_NAME → $NEW_VERSION_NAME"
echo "  Version Code: $CURRENT_VERSION_CODE → $NEW_VERSION_CODE"
