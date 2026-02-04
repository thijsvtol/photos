#!/bin/bash
# Development setup script for photos subdomain

set -e

echo "🔧 Setting up Photos Subdomain Development Environment"
echo ""

# Navigate to subdomain root
cd "$(dirname "$0")"

# Install worker dependencies
echo "📦 Installing Worker dependencies..."
cd apps/worker
npm install
cd ../..

# Install web dependencies
echo "📦 Installing Web dependencies..."
cd apps/web
npm install
cd ../..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Set up D1 database:"
echo "   wrangler d1 create photos-db-local --local"
echo "   wrangler d1 execute photos-db-local --local --file=./migrations/001_init.sql"
echo ""
echo "2. Set secrets (optional for local dev):"
echo "   cd apps/worker"
echo "   wrangler secret put EVENT_COOKIE_SECRET --env development"
echo "   wrangler secret put ADMIN_SHARED_SECRET --env development"
echo ""
echo "3. Start development servers:"
echo "   Terminal 1: cd apps/worker && npm run dev"
echo "   Terminal 2: cd apps/web && npm run dev"
echo ""
echo "Then visit http://localhost:3000"
