#!/bin/bash
set -euo pipefail

# Infrastructure Status Checker
# Displays current status of all Cloudflare resources

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/cloudflare-config.json"
STATE_FILE="${SCRIPT_DIR}/.deployment-state.json"

# Color helpers
header() { echo -e "\n\033[1;34m=== $* ===\033[0m"; }
info() { echo -e "\033[0;36m  ✓ $*\033[0m"; }
warn() { echo -e "\033[0;33m  ⚠ $*\033[0m"; }
error() { echo -e "\033[0;31m  ✗ $*\033[0m"; }

# Check if wrangler is available
if ! command -v wrangler >/dev/null 2>&1; then
    error "wrangler CLI not found. Install with: npm install -g wrangler"
    exit 1
fi

header "Cloudflare Infrastructure Status"

# Load configuration
if [[ ! -f "$CONFIG_FILE" ]]; then
    error "Configuration file not found: $CONFIG_FILE"
    exit 1
fi

PROJECT_NAME=$(jq -r '.project_name' "$CONFIG_FILE")
DOMAIN=$(jq -r '.domain.subdomain + "." + .domain.zone' "$CONFIG_FILE")

echo "Project: $PROJECT_NAME"
echo "Domain: $DOMAIN"

# Check deployment state
if [[ -f "$STATE_FILE" ]]; then
    info "Deployment state file found"
    STATE_EXISTS=true
else
    warn "No deployment state file found (run ./deploy.sh first)"
    STATE_EXISTS=false
fi

header "R2 Storage Status"
BUCKET_NAME=$(jq -r '.storage.r2_bucket' "$CONFIG_FILE")
if wrangler r2 bucket list 2>/dev/null | grep -q "$BUCKET_NAME"; then
    info "Bucket '$BUCKET_NAME' exists"
    
    # Try to get bucket info (requires appropriate permissions)
    echo "  Checking bucket contents..."
    if OBJECT_COUNT=$(wrangler r2 object list "$BUCKET_NAME" 2>/dev/null | wc -l); then
        info "Contains approximately $OBJECT_COUNT objects"
    fi
else
    warn "Bucket '$BUCKET_NAME' not found"
fi

header "D1 Database Status"
DB_NAME=$(jq -r '.database.d1_name' "$CONFIG_FILE")
DB_LIST=$(wrangler d1 list --json 2>/dev/null || echo '[]')
DB_INFO=$(echo "$DB_LIST" | jq --arg name "$DB_NAME" '.[] | select(.name == $name)')

if [[ -n "$DB_INFO" ]]; then
    DB_ID=$(echo "$DB_INFO" | jq -r '.uuid')
    DB_VERSION=$(echo "$DB_INFO" | jq -r '.version // "unknown"')
    info "Database '$DB_NAME' exists (ID: $DB_ID)"
    
    # Check tables
    echo "  Checking database schema..."
    TABLES=$(wrangler d1 execute "$DB_NAME" --remote --command "SELECT name FROM sqlite_master WHERE type='table'" 2>/dev/null || echo "")
    if [[ -n "$TABLES" ]]; then
        info "Database tables found:"
        echo "$TABLES" | grep -v "^Executing" | sed 's/^/    /'
    else
        warn "No tables found (migrations may not be applied)"
    fi
    
    # Check event count
    EVENT_COUNT=$(wrangler d1 execute "$DB_NAME" --remote --command "SELECT COUNT(*) as count FROM events" 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo "0")
    info "Events in database: $EVENT_COUNT"
else
    warn "Database '$DB_NAME' not found"
fi

header "Worker Status"
WORKER_NAME=$(jq -r '.worker.name' "$CONFIG_FILE")
DEPLOYMENTS=$(wrangler deployments list 2>/dev/null || echo "")

if echo "$DEPLOYMENTS" | grep -q "$WORKER_NAME"; then
    info "Worker '$WORKER_NAME' is deployed"
    echo "  Recent deployments:"
    echo "$DEPLOYMENTS" | head -5 | sed 's/^/    /'
else
    warn "Worker '$WORKER_NAME' not found or not deployed"
fi

header "DNS & Routes Status"
ZONE_NAME=$(jq -r '.domain.zone' "$CONFIG_FILE")
SUBDOMAIN=$(jq -r '.domain.subdomain' "$CONFIG_FILE")

info "Expected domain: $DOMAIN"
readarray -t ROUTES < <(jq -r '.worker.routes[]' "$CONFIG_FILE")
echo "  Configured routes:"
for route in "${ROUTES[@]}"; do
    echo "    - $route"
done

header "Pages Status"
PAGES_PROJECT=$(jq -r '.pages.project_name' "$CONFIG_FILE")
warn "Pages projects must be checked via Cloudflare Dashboard"
echo "  Expected project: $PAGES_PROJECT"
echo "  URL: https://dash.cloudflare.com → Pages → $PAGES_PROJECT"

header "Access Configuration"
APP_NAME=$(jq -r '.access.application_name' "$CONFIG_FILE")
warn "Access applications must be checked via Cloudflare Dashboard"
echo "  Expected application: $APP_NAME"
echo "  Protected paths:"
jq -r '.access.protected_paths[]' "$CONFIG_FILE" | sed 's/^/    - /'
echo "  URL: https://dash.cloudflare.com → Zero Trust → Access → Applications"

header "Summary"

if [[ "$STATE_EXISTS" == true ]]; then
    info "Infrastructure appears to be deployed"
    echo ""
    echo "State Information:"
    jq '.' "$STATE_FILE" 2>/dev/null || echo "  (Unable to parse state file)"
else
    warn "Infrastructure may not be fully deployed"
    echo ""
    echo "Run './deploy.sh' to provision infrastructure"
fi

echo ""
echo "For detailed logs, check:"
echo "  Worker logs: wrangler tail --env production"
echo "  Pages logs: Cloudflare Dashboard → Pages → $PAGES_PROJECT → Deployments"
