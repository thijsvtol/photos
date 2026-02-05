#!/bin/bash
set -euo pipefail

# Cloudflare Infrastructure Destruction Script
# WARNING: This will DELETE resources! Use with caution.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/cloudflare-config.json"
STATE_FILE="${SCRIPT_DIR}/.deployment-state.json"

# Colors
info() { echo -e "\033[0;36m[INFO]\033[0m $*"; }
warn() { echo -e "\033[0;33m[WARN]\033[0m $*"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $*"; }
success() { echo -e "\033[0;32m[SUCCESS]\033[0m $*"; }

confirm_deletion() {
    local resource=$1
    echo ""
    warn "⚠️  WARNING: You are about to DELETE $resource"
    warn "This action CANNOT be undone!"
    echo ""
    read -p "Type 'DELETE' to confirm: " confirmation
    
    if [[ "$confirmation" != "DELETE" ]]; then
        info "Deletion cancelled"
        return 1
    fi
    return 0
}

destroy_worker() {
    local worker_name=$(jq -r '.worker.name' "$CONFIG_FILE")
    
    if confirm_deletion "Worker: $worker_name"; then
        info "Deleting worker $worker_name..."
        wrangler delete "$worker_name" --force || warn "Worker may not exist"
        success "Worker deleted"
    fi
}

destroy_d1_database() {
    local db_name=$(jq -r '.database.d1_name' "$CONFIG_FILE")
    
    if confirm_deletion "D1 Database: $db_name (ALL DATA WILL BE LOST)"; then
        info "Deleting database $db_name..."
        # Get database ID
        local db_list=$(wrangler d1 list --json 2>/dev/null || echo '[]')
        local db_id=$(echo "$db_list" | jq -r --arg name "$db_name" '.[] | select(.name == $name) | .uuid')
        
        if [[ -n "$db_id" ]]; then
            wrangler d1 delete "$db_name" --force || warn "Database may not exist"
            success "Database deleted"
        else
            warn "Database not found"
        fi
    fi
}

destroy_r2_bucket() {
    local bucket_name=$(jq -r '.storage.r2_bucket' "$CONFIG_FILE")
    
    if confirm_deletion "R2 Bucket: $bucket_name (ALL PHOTOS WILL BE LOST)"; then
        if wrangler r2 bucket list | grep -q "$bucket_name"; then
            info "Deleting all objects in bucket $bucket_name..."
            
            # Attempt to list and delete objects
            # Note: Wrangler CLI has limited bulk delete support
            # For large buckets, use dashboard or API
            local object_list=$(wrangler r2 object list "$bucket_name" 2>/dev/null || echo "")
            
            if [[ -n "$object_list" ]]; then
                warn "Bucket contains objects. Attempting to delete..."
                # This is a limitation - wrangler doesn't support bulk delete efficiently
                # For production use, recommend using S3-compatible API or dashboard
                warn "For buckets with many objects, delete via dashboard:"
                warn "  https://dash.cloudflare.com → R2 → $bucket_name → Delete"
            fi
            
            info "Attempting to delete bucket $bucket_name..."
            wrangler r2 bucket delete "$bucket_name" --force || warn "Bucket deletion failed (may not be empty - delete objects first)"
            success "Bucket deletion attempted"
        else
            warn "Bucket not found"
        fi
    fi
}

remove_state() {
    if [[ -f "$STATE_FILE" ]]; then
        if confirm_deletion "Deployment state file"; then
            # Create backup
            cp "$STATE_FILE" "${STATE_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
            rm "$STATE_FILE"
            success "State file removed (backup created)"
        fi
    else
        info "No state file to remove"
    fi
}

show_manual_steps() {
    echo ""
    warn "=== Manual Cleanup Required ==="
    echo ""
    echo "The following resources must be removed manually via Cloudflare Dashboard:"
    echo ""
    echo "1. Pages Project:"
    echo "   - Go to: Workers & Pages → Pages"
    echo "   - Delete project: $(jq -r '.pages.project_name' "$CONFIG_FILE")"
    echo ""
    echo "2. Access Application:"
    echo "   - Go to: Zero Trust → Access → Applications"
    echo "   - Delete application: $(jq -r '.access.application_name' "$CONFIG_FILE")"
    echo ""
    echo "3. Worker Routes:"
    echo "   - Go to: Websites → $(jq -r '.domain.zone' "$CONFIG_FILE") → Workers Routes"
    echo "   - Remove routes for: $(jq -r '.domain.subdomain' "$CONFIG_FILE").$(jq -r '.domain.zone' "$CONFIG_FILE")"
    echo ""
    echo "4. DNS Records (if not used elsewhere):"
    echo "   - Go to: Websites → $(jq -r '.domain.zone' "$CONFIG_FILE") → DNS"
    echo "   - Remove CNAME for: $(jq -r '.domain.subdomain' "$CONFIG_FILE")"
    echo ""
}

main() {
    warn "============================================"
    warn "   Cloudflare Infrastructure Destroyer"
    warn "============================================"
    echo ""
    warn "This script will help you DELETE Cloudflare resources"
    warn "Each resource will require individual confirmation"
    echo ""
    read -p "Press Enter to continue or Ctrl+C to abort..." || exit 1
    
    # Destroy resources in order (least to most destructive)
    destroy_worker
    destroy_d1_database
    destroy_r2_bucket
    remove_state
    
    echo ""
    success "Automated cleanup complete!"
    show_manual_steps
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
