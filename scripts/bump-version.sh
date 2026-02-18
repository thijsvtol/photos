#!/bin/bash

# Script to manually bump Android and package.json versions
# Usage: ./scripts/bump-version.sh [patch|minor|major]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to Android directory
cd "$PROJECT_ROOT/apps/android/app"

# Read current Android version
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

echo "✅ Android version updated!"
echo "  Version Name: $CURRENT_VERSION_NAME → $NEW_VERSION_NAME"
echo "  Version Code: $CURRENT_VERSION_CODE → $NEW_VERSION_CODE"

# Update package.json files
if [ "$1" = "major" ] || [ "$1" = "minor" ] || [ "$1" = "patch" ]; then
    echo ""
    echo "Updating package.json files..."
    
    PACKAGE_DIRS=(
        "$PROJECT_ROOT"
        "$PROJECT_ROOT/apps/web"
        "$PROJECT_ROOT/apps/worker"
    )
    
    for PACKAGE_DIR in "${PACKAGE_DIRS[@]}"; do
        if [ -f "$PACKAGE_DIR/package.json" ]; then
            OLD_PKG_VERSION=$(grep -m 1 '"version"' "$PACKAGE_DIR/package.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')
            
            # Use npm version to update (--no-git-tag-version to skip git operations)
            (cd "$PACKAGE_DIR" && npm version "$NEW_VERSION_NAME" --no-git-tag-version --allow-same-version) > /dev/null
            
            RELATIVE_PATH=$(echo "$PACKAGE_DIR" | sed "s|$PROJECT_ROOT|.|")
            if [ "$RELATIVE_PATH" = "." ]; then
                echo "  ✓ package.json: $OLD_PKG_VERSION → $NEW_VERSION_NAME"
            else
                echo "  ✓ $RELATIVE_PATH/package.json: $OLD_PKG_VERSION → $NEW_VERSION_NAME"
            fi
        fi
    done
    
    echo ""
    echo "✅ All versions synchronized to $NEW_VERSION_NAME"
fi
