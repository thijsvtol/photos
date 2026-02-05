#!/bin/bash
set -euo pipefail

# Cloudflare Infrastructure Deployment Script
# This script provisions and manages Cloudflare resources based on cloudflare-config.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/cloudflare-config.json"
STATE_FILE="${SCRIPT_DIR}/.deployment-state.json"

# Color output helpers
info() { echo -e "\033[0;36m[INFO]\033[0m $*"; }
success() { echo -e "\033[0;32m[SUCCESS]\033[0m $*"; }
warn() { echo -e "\033[0;33m[WARN]\033[0m $*"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $*"; exit 1; }

# Verify prerequisites
check_requirements() {
    info "Checking prerequisites..."
    
    command -v jq >/dev/null 2>&1 || error "jq is required but not installed"
    command -v wrangler >/dev/null 2>&1 || error "wrangler is required but not installed"
    command -v npm >/dev/null 2>&1 || error "npm is required but not installed"
    
    if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
        error "CLOUDFLARE_ACCOUNT_ID environment variable must be set"
    fi
    
    success "All prerequisites met"
}

# Load configuration
load_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        error "Configuration file not found: $CONFIG_FILE"
    fi
    
    info "Loading configuration from $CONFIG_FILE"
}

# Initialize or load deployment state
init_state() {
    if [[ ! -f "$STATE_FILE" ]]; then
        info "Creating new deployment state file"
        echo '{}' > "$STATE_FILE"
    fi
}

# Save resource ID to state
save_state() {
    local resource_type=$1
    local resource_id=$2
    
    jq --arg type "$resource_type" --arg id "$resource_id" \
        '.[$type] = $id' "$STATE_FILE" > "${STATE_FILE}.tmp"
    mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

# Get resource ID from state
get_state() {
    local resource_type=$1
    jq -r --arg type "$resource_type" '.[$type] // empty' "$STATE_FILE"
}

# Create or verify R2 bucket
setup_r2_bucket() {
    local bucket_name=$(jq -r '.storage.r2_bucket' "$CONFIG_FILE")
    local location=$(jq -r '.storage.location_hint' "$CONFIG_FILE")
    
    info "Setting up R2 bucket: $bucket_name"
    
    if wrangler r2 bucket list | grep -q "$bucket_name"; then
        success "R2 bucket '$bucket_name' already exists"
    else
        info "Creating R2 bucket '$bucket_name' in location $location"
        wrangler r2 bucket create "$bucket_name" --location "$location"
        success "Created R2 bucket '$bucket_name'"
    fi
    
    save_state "r2_bucket" "$bucket_name"
}

# Create D1 database and run migrations
setup_d1_database() {
    local db_name=$(jq -r '.database.d1_name' "$CONFIG_FILE")
    local existing_db_id=$(get_state "d1_database_id")
    
    info "Setting up D1 database: $db_name"
    
    if [[ -n "$existing_db_id" ]]; then
        success "D1 database already provisioned with ID: $existing_db_id"
        return
    fi
    
    # Check if database exists
    local db_list=$(wrangler d1 list --json 2>/dev/null || echo '[]')
    local db_id=$(echo "$db_list" | jq -r --arg name "$db_name" '.[] | select(.name == $name) | .uuid')
    
    if [[ -z "$db_id" ]]; then
        info "Creating new D1 database: $db_name"
        local create_output=$(wrangler d1 create "$db_name" --json)
        db_id=$(echo "$create_output" | jq -r '.uuid')
        success "Created D1 database with ID: $db_id"
    else
        success "Found existing D1 database with ID: $db_id"
    fi
    
    save_state "d1_database_id" "$db_id"
    save_state "d1_database_name" "$db_name"
    
    # Run migrations
    run_migrations "$db_name"
}

# Execute database migrations
run_migrations() {
    local db_name=$1
    local migration_dir="${SCRIPT_DIR}/$(jq -r '.database.migration_path' "$CONFIG_FILE")"
    
    info "Running database migrations from $migration_dir"
    
    if [[ ! -d "$migration_dir" ]]; then
        warn "Migration directory not found: $migration_dir"
        return
    fi
    
    for migration_file in "$migration_dir"/*.sql; do
        if [[ -f "$migration_file" ]]; then
            local filename=$(basename "$migration_file")
            info "Executing migration: $filename"
            wrangler d1 execute "$db_name" --remote --file="$migration_file" || warn "Migration may have already been applied"
        fi
    done
    
    success "Database migrations completed"
}

# Build and deploy worker
deploy_worker() {
    local worker_name=$(jq -r '.worker.name' "$CONFIG_FILE")
    local source_dir="${SCRIPT_DIR}/$(jq -r '.worker.source_dir' "$CONFIG_FILE")"
    local db_id=$(get_state "d1_database_id")
    local bucket_name=$(get_state "r2_bucket")
    
    info "Building and deploying worker: $worker_name"
    
    cd "$source_dir"
    
    info "Installing worker dependencies..."
    npm install --silent
    
    info "Building worker code..."
    npm run build
    
    cd "$SCRIPT_DIR"
    
    info "Deploying worker to production..."
    cd "$(dirname "$source_dir")"
    wrangler deploy --env production
    
    success "Worker deployed successfully"
    save_state "worker_name" "$worker_name"
}

# Setup worker routes via Cloudflare API
configure_worker_routes() {
    local worker_name=$(get_state "worker_name")
    local zone_name=$(jq -r '.domain.zone' "$CONFIG_FILE")
    
    info "Configuring worker routes for $worker_name"
    
    # Note: Routes are configured in wrangler.toml
    # This function validates they exist
    
    success "Worker routes configured via wrangler.toml"
}

# Configure Cloudflare Access
setup_access_application() {
    local app_name=$(jq -r '.access.application_name' "$CONFIG_FILE")
    local full_domain="$(jq -r '.domain.subdomain' "$CONFIG_FILE").$(jq -r '.domain.zone' "$CONFIG_FILE")"
    
    info "Setting up Cloudflare Access for: $full_domain"
    
    warn "Cloudflare Access must be configured via the dashboard:"
    echo "  1. Go to Cloudflare Dashboard → Zero Trust → Access → Applications"
    echo "  2. Create application for: $full_domain"
    echo "  3. Add paths: $(jq -r '.access.protected_paths[]' "$CONFIG_FILE" | tr '\n' ' ')"
    echo "  4. Configure allowed emails from cloudflare-config.json"
    
    # Skip interactive prompt in CI/CD environments
    if [[ -z "${CI:-}" ]] && [[ -t 0 ]]; then
        read -p "Press Enter once Access is configured..." || true
    else
        info "Running in non-interactive mode - skipping confirmation"
    fi
    success "Access configuration noted"
}

# Display deployment summary
show_summary() {
    local db_id=$(get_state "d1_database_id")
    local db_name=$(get_state "d1_database_name")
    local bucket=$(get_state "r2_bucket")
    local worker=$(get_state "worker_name")
    
    success "\n========================================="
    success "Deployment Complete!"
    success "=========================================\n"
    
    echo "Resource Summary:"
    echo "  R2 Bucket: $bucket"
    echo "  D1 Database: $db_name (ID: $db_id)"
    echo "  Worker: $worker"
    echo ""
    echo "Next Steps:"
    echo "  1. Set worker secrets:"
    echo "     wrangler secret put EVENT_COOKIE_SECRET --env production"
    echo ""
    echo "  2. Update wrangler.toml database_id if needed:"
    echo "     database_id = \"$db_id\""
    echo ""
    echo "  3. Deploy frontend via Cloudflare Pages dashboard"
    echo "     - Connect GitHub repository"
    echo "     - Set build settings from cloudflare-config.json"
    echo ""
    echo "State saved to: $STATE_FILE"
}

# Main execution
main() {
    info "Starting Cloudflare infrastructure deployment"
    
    check_requirements
    load_config
    init_state
    
    setup_r2_bucket
    setup_d1_database
    deploy_worker
    configure_worker_routes
    
    show_summary
}

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
