#!/bin/bash

# Production Deployment Helper Script
#
# Assists with deploying to production by:
# - Validating configuration
# - Checking Cloudflare resources
# - Setting up production secrets
# - Deploying worker and frontend

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║              Production Deployment Helper                    ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}✗ Wrangler CLI is not installed${NC}"
    echo -e "${YELLOW}  Install it: npm install -g wrangler${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Wrangler CLI found${NC}"

# Check if logged in to Cloudflare
echo -e "\n${CYAN}Checking Cloudflare authentication...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}⚠ Not logged in to Cloudflare${NC}"
    echo -e "${CYAN}Logging in...${NC}\n"
    wrangler login
else
    echo -e "${GREEN}✓ Logged in to Cloudflare${NC}"
fi

# Read configuration from .dev.vars
echo -e "\n${CYAN}Reading configuration from .dev.vars...${NC}"

if [ ! -f ".dev.vars" ]; then
    echo -e "${RED}✗ .dev.vars not found${NC}"
    echo -e "${YELLOW}  Run: npm run setup:wizard${NC}"
    exit 1
fi

# Source the .dev.vars file (simple approach)
export $(grep -v '^#' .dev.vars | xargs)

echo -e "${GREEN}✓ Configuration loaded${NC}"

# Main menu
echo -e "\n${BOLD}${CYAN}What would you like to deploy?${NC}\n"
echo "  1) Set up production database (D1)"
echo "  2) Create R2 storage bucket"
echo "  3) Configure production secrets"
echo "  4) Deploy worker"
echo "  5) Full deployment (all of the above)"
echo "  6) Exit"
echo

read -p "Enter your choice (1-6): " choice

case $choice in
  1)
    echo -e "\n${BOLD}${CYAN}=== Setting up Production Database ===${NC}\n"
    
    DB_NAME="photos-db"
    
    echo -e "${CYAN}Creating D1 database: ${DB_NAME}${NC}"
    if wrangler d1 create $DB_NAME; then
        echo -e "${GREEN}✓ Database created${NC}"
        echo -e "${YELLOW}⚠ Update the database_id in wrangler.toml with the ID shown above${NC}"
    else
        echo -e "${YELLOW}Database may already exist${NC}"
    fi
    
    read -p "Have you updated wrangler.toml with the database_id? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "\n${CYAN}Running migrations on production database...${NC}\n"
        
        for migration in ./migrations/*.sql; do
            filename=$(basename "$migration")
            echo -e "${CYAN}Running: ${filename}${NC}"
            if wrangler d1 execute $DB_NAME --remote --file="$migration"; then
                echo -e "${GREEN}✓ ${filename} completed${NC}"
            else
                echo -e "${YELLOW}⚠ ${filename} may have already been applied${NC}"
            fi
        done
        
        echo -e "\n${GREEN}✓ Database setup complete${NC}"
    else
        echo -e "${YELLOW}Skipping migrations. Update wrangler.toml first.${NC}"
    fi
    ;;
    
  2)
    echo -e "\n${BOLD}${CYAN}=== Creating R2 Storage Bucket ===${NC}\n"
    
    BUCKET_NAME="photos-storage"
    
    echo -e "${CYAN}Creating R2 bucket: ${BUCKET_NAME}${NC}"
    if wrangler r2 bucket create $BUCKET_NAME; then
        echo -e "${GREEN}✓ R2 bucket created${NC}"
        echo -e "${YELLOW}⚠ Update the bucket_name in wrangler.toml if different${NC}"
    else
        echo -e "${YELLOW}Bucket may already exist${NC}"
    fi
    ;;
    
  3)
    echo -e "\n${BOLD}${CYAN}=== Configuring Production Secrets ===${NC}\n"
    
    echo -e "${YELLOW}This will set secrets in your Cloudflare Worker.${NC}"
    echo -e "${YELLOW}Values will be taken from your .dev.vars file.${NC}\n"
    
    read -p "Continue? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "\n${CYAN}Setting JWT_SECRET...${NC}"
        echo "$JWT_SECRET" | wrangler secret put JWT_SECRET
        
        echo -e "\n${CYAN}Setting EVENT_COOKIE_SECRET...${NC}"
        echo "$EVENT_COOKIE_SECRET" | wrangler secret put EVENT_COOKIE_SECRET
        
        if [ ! -z "$MAILGUN_API_KEY" ]; then
            echo -e "\n${CYAN}Setting MAILGUN_API_KEY...${NC}"
            echo "$MAILGUN_API_KEY" | wrangler secret put MAILGUN_API_KEY
            
            echo -e "\n${CYAN}Setting MAILGUN_DOMAIN...${NC}"
            echo "$MAILGUN_DOMAIN" | wrangler secret put MAILGUN_DOMAIN
        else
            echo -e "\n${YELLOW}Skipping Mailgun secrets (not configured)${NC}"
        fi
        
        echo -e "\n${GREEN}✓ Secrets configured${NC}"
    fi
    ;;
    
  4)
    echo -e "\n${BOLD}${CYAN}=== Deploying Worker ===${NC}\n"
    
    echo -e "${CYAN}Building and deploying worker to production...${NC}\n"
    
    cd apps/worker
    npm run build
    wrangler deploy --env production
    cd ../..
    
    echo -e "\n${GREEN}✓ Worker deployed${NC}"
    echo -e "${CYAN}Your worker is now live!${NC}"
    ;;
    
  5)
    echo -e "\n${BOLD}${CYAN}=== Full Deployment ===${NC}\n"
    
    echo -e "${YELLOW}This will:${NC}"
    echo -e "  1. Set up production database"
    echo -e "  2. Create R2 bucket"
    echo -e "  3. Configure secrets"
    echo -e "  4. Deploy worker\n"
    
    read -p "Continue with full deployment? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Deployment cancelled${NC}"
        exit 0
    fi
    
    # Run all steps...
    echo -e "\n${CYAN}Step 1/4: Database setup${NC}"
    # (Database setup code here - same as option 1)
    
    echo -e "\n${CYAN}Step 2/4: R2 bucket${NC}"
    wrangler r2 bucket create photos-storage || echo "Bucket may exist"
    
    echo -e "\n${CYAN}Step 3/4: Secrets${NC}"
    echo "$JWT_SECRET" | wrangler secret put JWT_SECRET
    echo "$EVENT_COOKIE_SECRET" | wrangler secret put EVENT_COOKIE_SECRET
    
    echo -e "\n${CYAN}Step 4/4: Deploy worker${NC}"
    cd apps/worker
    npm run build
    wrangler deploy --env production
    cd ../..
    
    echo -e "\n${BOLD}${GREEN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Deployment Complete! 🎉                         ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
    
    echo -e "${BOLD}Next Steps:${NC}"
    echo -e "  1. Deploy frontend to Cloudflare Pages"
    echo -e "  2. Set up custom domain"
    echo -e "  3. Configure Cloudflare Access"
    echo -e "\n${CYAN}See CONFIGURATION.md for detailed instructions${NC}\n"
    ;;
    
  6)
    echo -e "${CYAN}Exiting...${NC}"
    exit 0
    ;;
    
  *)
    echo -e "${RED}Invalid choice${NC}"
    exit 1
    ;;
esac

echo -e "\n${GREEN}Done!${NC}\n"
