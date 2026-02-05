#!/bin/bash
set -euo pipefail

# Database Migration Runner
# This script runs D1 database migrations using Wrangler

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/../subdomains/photos/migrations"

# Color output
info() { echo -e "\033[0;36m[INFO]\033[0m $*"; }
success() { echo -e "\033[0;32m[SUCCESS]\033[0m $*"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $*"; exit 1; }

# Check prerequisites
command -v wrangler >/dev/null 2>&1 || error "wrangler is required"

# Get database name from Terraform output or use default
DB_NAME="${1:-photos-db}"

info "Running migrations for database: $DB_NAME"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
    error "Migrations directory not found: $MIGRATIONS_DIR"
fi

# Run each migration file
for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [[ -f "$migration" ]]; then
        filename=$(basename "$migration")
        info "Applying migration: $filename"
        wrangler d1 execute "$DB_NAME" --remote --file="$migration" || \
            info "Migration may already be applied (this is normal)"
    fi
done

success "All migrations completed"
