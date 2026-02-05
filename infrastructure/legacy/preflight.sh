#!/bin/bash
set -euo pipefail

# Pre-flight Check Script
# Validates environment and prerequisites before deployment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/cloudflare-config.json"

# Colors
check() { echo -e "\033[0;36m[CHECK]\033[0m $*"; }
pass() { echo -e "\033[0;32m  ✓ $*\033[0m"; }
fail() { echo -e "\033[0;31m  ✗ $*\033[0m"; }
warn() { echo -e "\033[0;33m  ⚠ $*\033[0m"; }
info() { echo -e "\033[0;34m  ℹ $*\033[0m"; }

FAILED_CHECKS=0

header() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Infrastructure Pre-flight Checks"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Check if command exists
check_command() {
    local cmd=$1
    local install_hint=$2
    
    if command -v "$cmd" >/dev/null 2>&1; then
        pass "$cmd is installed ($(command -v "$cmd"))"
        return 0
    else
        fail "$cmd is NOT installed"
        info "Install with: $install_hint"
        ((FAILED_CHECKS++))
        return 1
    fi
}

# Check environment variable
check_env_var() {
    local var_name=$1
    local hint=$2
    
    if [[ -n "${!var_name:-}" ]]; then
        pass "$var_name is set"
        return 0
    else
        warn "$var_name is NOT set"
        info "$hint"
        return 1
    fi
}

# Check file exists
check_file() {
    local file=$1
    local description=$2
    
    if [[ -f "$file" ]]; then
        pass "$description exists: $file"
        return 0
    else
        fail "$description NOT found: $file"
        ((FAILED_CHECKS++))
        return 1
    fi
}

# Check JSON validity
check_json() {
    local file=$1
    
    if jq empty "$file" 2>/dev/null; then
        pass "JSON is valid: $file"
        return 0
    else
        fail "JSON is INVALID: $file"
        ((FAILED_CHECKS++))
        return 1
    fi
}

# Main checks
main() {
    header
    
    echo ""
    check "Checking required commands..."
    check_command "wrangler" "npm install -g wrangler"
    check_command "npm" "Install Node.js from https://nodejs.org/"
    check_command "jq" "brew install jq (macOS) or apt-get install jq (Linux)"
    check_command "git" "System package manager"
    
    echo ""
    check "Checking Wrangler authentication..."
    if wrangler whoami >/dev/null 2>&1; then
        pass "Wrangler is authenticated"
        ACCOUNT_INFO=$(wrangler whoami 2>/dev/null || echo "")
        if [[ -n "$ACCOUNT_INFO" ]]; then
            info "Logged in as: $(echo "$ACCOUNT_INFO" | grep -i "email" | head -1 || echo "Unknown")"
        fi
    else
        warn "Wrangler is NOT authenticated"
        info "Run: wrangler login"
    fi
    
    echo ""
    check "Checking environment variables..."
    if check_env_var "CLOUDFLARE_ACCOUNT_ID" "Set with: export CLOUDFLARE_ACCOUNT_ID='your-account-id'"; then
        info "Account ID: ${CLOUDFLARE_ACCOUNT_ID:0:8}..."
    fi
    
    if check_env_var "CLOUDFLARE_API_TOKEN" "Optional: Set with: export CLOUDFLARE_API_TOKEN='your-token' (or use wrangler login)"; then
        info "API Token: ${CLOUDFLARE_API_TOKEN:0:8}..."
    else
        info "Using Wrangler authentication instead (this is fine)"
    fi
    
    echo ""
    check "Checking configuration files..."
    check_file "$CONFIG_FILE" "Configuration file"
    if [[ -f "$CONFIG_FILE" ]]; then
        check_json "$CONFIG_FILE"
        
        # Validate configuration content
        if jq -e '.domain.zone' "$CONFIG_FILE" >/dev/null 2>&1; then
            DOMAIN_ZONE=$(jq -r '.domain.zone' "$CONFIG_FILE")
            pass "Domain zone configured: $DOMAIN_ZONE"
        else
            fail "Domain zone not configured in JSON"
            ((FAILED_CHECKS++))
        fi
        
        if jq -e '.access.allowed_emails | length > 0' "$CONFIG_FILE" >/dev/null 2>&1; then
            EMAIL_COUNT=$(jq -r '.access.allowed_emails | length' "$CONFIG_FILE")
            pass "Admin emails configured: $EMAIL_COUNT address(es)"
        else
            warn "No admin emails configured"
            info "Add emails to .access.allowed_emails in $CONFIG_FILE"
        fi
    fi
    
    echo ""
    check "Checking repository structure..."
    check_file "${SCRIPT_DIR}/deploy.sh" "Deployment script"
    check_file "${SCRIPT_DIR}/status.sh" "Status script"
    check_file "${SCRIPT_DIR}/../subdomains/photos/wrangler.toml" "Wrangler config"
    check_file "${SCRIPT_DIR}/../subdomains/photos/apps/worker/package.json" "Worker package.json"
    check_file "${SCRIPT_DIR}/../subdomains/photos/apps/web/package.json" "Web package.json"
    
    echo ""
    check "Checking migration files..."
    MIGRATION_DIR="${SCRIPT_DIR}/../subdomains/photos/migrations"
    if [[ -d "$MIGRATION_DIR" ]]; then
        MIGRATION_COUNT=$(find "$MIGRATION_DIR" -name "*.sql" | wc -l)
        if [[ "$MIGRATION_COUNT" -gt 0 ]]; then
            pass "Found $MIGRATION_COUNT migration file(s)"
        else
            warn "No migration files found in $MIGRATION_DIR"
        fi
    else
        fail "Migration directory not found: $MIGRATION_DIR"
        ((FAILED_CHECKS++))
    fi
    
    echo ""
    check "Checking script permissions..."
    if [[ -x "${SCRIPT_DIR}/deploy.sh" ]]; then
        pass "deploy.sh is executable"
    else
        warn "deploy.sh is not executable"
        info "Run: chmod +x ${SCRIPT_DIR}/deploy.sh"
    fi
    
    if [[ -x "${SCRIPT_DIR}/status.sh" ]]; then
        pass "status.sh is executable"
    else
        warn "status.sh is not executable"
        info "Run: chmod +x ${SCRIPT_DIR}/status.sh"
    fi
    
    echo ""
    check "Checking for existing resources..."
    BUCKET_NAME=$(jq -r '.storage.r2_bucket' "$CONFIG_FILE" 2>/dev/null || echo "")
    if [[ -n "$BUCKET_NAME" ]] && wrangler r2 bucket list 2>/dev/null | grep -q "$BUCKET_NAME"; then
        info "R2 bucket '$BUCKET_NAME' already exists (will be reused)"
    fi
    
    DB_NAME=$(jq -r '.database.d1_name' "$CONFIG_FILE" 2>/dev/null || echo "")
    if [[ -n "$DB_NAME" ]]; then
        DB_LIST=$(wrangler d1 list --json 2>/dev/null || echo '[]')
        if echo "$DB_LIST" | jq -e --arg name "$DB_NAME" '.[] | select(.name == $name)' >/dev/null 2>&1; then
            info "D1 database '$DB_NAME' already exists (will be reused)"
        fi
    fi
    
    # Summary
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [[ $FAILED_CHECKS -eq 0 ]]; then
        pass "All critical checks passed! ✓"
        echo ""
        info "You're ready to deploy:"
        echo "  ./deploy.sh"
        echo ""
    else
        fail "Found $FAILED_CHECKS critical issue(s)"
        echo ""
        info "Fix the issues above before deploying"
        echo ""
        exit 1
    fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
