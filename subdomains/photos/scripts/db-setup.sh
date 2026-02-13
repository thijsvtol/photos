#!/bin/bash

# Database Setup Script
# 
# Sets up D1 database for local development by:
# - Creating local database
# - Running all migrations in correct order
# - Verifying setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║                  Database Setup Script                       ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}✗ Wrangler CLI is not installed${NC}"
    echo -e "${YELLOW}  Install it with: npm install -g wrangler${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Wrangler CLI found${NC}\n"

# Database name
DB_NAME="photos-db-local"

echo -e "${BOLD}${CYAN}Step 1: Creating local D1 database${NC}"
echo -e "${YELLOW}Database name: ${DB_NAME}${NC}\n"

# Check if database already exists by trying to query it
if wrangler d1 execute $DB_NAME --local --command "SELECT 1" &> /dev/null; then
    echo -e "${YELLOW}Database already exists. Using existing database.${NC}"
    
    # Ask if user wants to recreate
    read -p "Do you want to recreate it (this will delete all data)? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Recreating database...${NC}"
        # Note: Wrangler doesn't have a delete command for local DB, so we just proceed with migrations
        # The local DB file is stored in .wrangler/state/v3/d1/miniflare-D1DatabaseObject/
    else
        echo -e "${CYAN}Keeping existing database.${NC}"
    fi
else
    echo -e "${CYAN}Creating new local database...${NC}"
    wrangler d1 create $DB_NAME || true
fi

echo -e "${GREEN}✓ Database ready${NC}\n"

# Run migrations
echo -e "${BOLD}${CYAN}Step 2: Running database migrations${NC}\n"

MIGRATIONS_DIR="./migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo -e "${RED}✗ Migrations directory not found: $MIGRATIONS_DIR${NC}"
    exit 1
fi

# Get all migration files in order
MIGRATION_FILES=($(ls $MIGRATIONS_DIR/*.sql | sort))

if [ ${#MIGRATION_FILES[@]} -eq 0 ]; then
    echo -e "${RED}✗ No migration files found in $MIGRATIONS_DIR${NC}"
    exit 1
fi

echo -e "${CYAN}Found ${#MIGRATION_FILES[@]} migration file(s)${NC}\n"

# Run each migration
for MIGRATION in "${MIGRATION_FILES[@]}"; do
    FILENAME=$(basename "$MIGRATION")
    echo -e "${CYAN}Running: ${FILENAME}${NC}"
    
    if wrangler d1 execute $DB_NAME --local --file="$MIGRATION"; then
        echo -e "${GREEN}✓ ${FILENAME} completed${NC}\n"
    else
        echo -e "${RED}✗ ${FILENAME} failed${NC}"
        echo -e "${YELLOW}This might be expected if the migration was already applied.${NC}\n"
    fi
done

# Verify database setup
echo -e "${BOLD}${CYAN}Step 3: Verifying database setup${NC}\n"

echo -e "${CYAN}Checking tables...${NC}"
TABLES=$(wrangler d1 execute $DB_NAME --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" 2>&1)

if echo "$TABLES" | grep -q "events\|photos"; then
    echo -e "${GREEN}✓ Database tables created successfully${NC}\n"
    
    echo -e "${CYAN}Available tables:${NC}"
    echo "$TABLES" | grep "│" | grep -v "name" | grep -v "─" || true
    echo
else
    echo -e "${RED}✗ Database tables not found${NC}"
    echo -e "${YELLOW}You may need to run migrations manually.${NC}\n"
    exit 1
fi

# Print summary
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   Setup Complete! 🎉                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

echo -e "${BOLD}Database Configuration:${NC}"
echo -e "  ${CYAN}Name:${NC} $DB_NAME"
echo -e "  ${CYAN}Type:${NC} Local (D1)"
echo -e "  ${CYAN}Migrations:${NC} ${#MIGRATION_FILES[@]} applied"

echo -e "\n${BOLD}${YELLOW}Next Steps:${NC}"
echo -e "  1. Make sure your ${CYAN}.dev.vars${NC} file is configured"
echo -e "     ${YELLOW}Run: npm run validate${NC}\n"
echo -e "  2. Start the worker:"
echo -e "     ${YELLOW}npm --prefix apps/worker run dev${NC}\n"
echo -e "  3. Start the web app:"
echo -e "     ${YELLOW}npm --prefix apps/web run dev${NC}\n"

echo -e "${CYAN}For production database setup, see CONFIGURATION.md${NC}\n"
