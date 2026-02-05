#!/bin/bash
# Terraform Import Script for Existing Cloudflare Resources
# 
# This script helps you import existing Cloudflare infrastructure into Terraform state.
# 
# INSTRUCTIONS:
# 1. Fill in your resource IDs below
# 2. Make the script executable: chmod +x import-resources.sh
# 3. Run: ./import-resources.sh
#
# To find your resource IDs, see the README.md "Importing Existing Resources" section.

set -e

# ============================================================================
# CONFIGURATION - FILL IN YOUR VALUES
# ============================================================================

# Get from Cloudflare Dashboard → Workers → Account ID
ACCOUNT_ID=""

# Get from Cloudflare Dashboard → Your Domain → Overview → Zone ID
ZONE_ID=""

# Get from: wrangler d1 list (look for UUID)
D1_DATABASE_UUID=""

# Get from Cloudflare API (see README for command)
API_ROUTE_ID=""
MEDIA_ROUTE_ID=""
DNS_RECORD_ID=""

# ============================================================================
# VALIDATION
# ============================================================================

if [ -z "$ACCOUNT_ID" ]; then
    echo "ERROR: ACCOUNT_ID is not set. Please edit this script and add your Cloudflare Account ID."
    exit 1
fi

if [ -z "$ZONE_ID" ]; then
    echo "ERROR: ZONE_ID is not set. Please edit this script and add your Zone ID."
    exit 1
fi

echo "Starting import process..."
echo "Account ID: $ACCOUNT_ID"
echo "Zone ID: $ZONE_ID"
echo ""

# ============================================================================
# IMPORT RESOURCES
# ============================================================================

echo "→ Importing R2 bucket (photos-storage)..."
terraform import cloudflare_r2_bucket.photos_storage "$ACCOUNT_ID/photos-storage" || echo "  ⚠ Already imported or error occurred"

if [ -n "$D1_DATABASE_UUID" ]; then
    echo "→ Importing D1 database (photos-db)..."
    terraform import cloudflare_d1_database.photos_db "$ACCOUNT_ID/$D1_DATABASE_UUID" || echo "  ⚠ Already imported or error occurred"
else
    echo "⊘ Skipping D1 database (D1_DATABASE_UUID not set)"
fi

echo "→ Importing Worker script (photos-worker)..."
terraform import cloudflare_worker_script.photos_worker "$ACCOUNT_ID/photos-worker" || echo "  ⚠ Already imported or error occurred"

if [ -n "$API_ROUTE_ID" ]; then
    echo "→ Importing Worker route (API)..."
    terraform import cloudflare_worker_route.photos_api "$ZONE_ID/$API_ROUTE_ID" || echo "  ⚠ Already imported or error occurred"
else
    echo "⊘ Skipping API route (API_ROUTE_ID not set)"
fi

if [ -n "$MEDIA_ROUTE_ID" ]; then
    echo "→ Importing Worker route (Media)..."
    terraform import cloudflare_worker_route.photos_media "$ZONE_ID/$MEDIA_ROUTE_ID" || echo "  ⚠ Already imported or error occurred"
else
    echo "⊘ Skipping Media route (MEDIA_ROUTE_ID not set)"
fi

if [ -n "$DNS_RECORD_ID" ]; then
    echo "→ Importing DNS record (photos subdomain)..."
    terraform import cloudflare_record.photos_subdomain "$ZONE_ID/$DNS_RECORD_ID" || echo "  ⚠ Already imported or error occurred"
else
    echo "⊘ Skipping DNS record (DNS_RECORD_ID not set)"
fi

# ============================================================================
# VERIFICATION
# ============================================================================

echo ""
echo "✓ Import process complete!"
echo ""
echo "Next steps:"
echo "  1. Run: terraform state list"
echo "     (to see all imported resources)"
echo ""
echo "  2. Run: terraform plan"
echo "     (should show: 'No changes. Your infrastructure matches the configuration.')"
echo ""
echo "  3. If plan shows changes, update your terraform.tfvars to match actual resource config"
echo ""
