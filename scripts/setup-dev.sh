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
echo ""
echo "1. Set up D1 database (local development):"
echo "   wrangler d1 create photos-db-local"
echo ""
echo "2. Run all database migrations (in order):"
echo "   wrangler d1 execute photos-db-local --local --file=./migrations/001_init.sql"
echo "   wrangler d1 execute photos-db-local --local --file=./migrations/002_add_exif_data.sql"
echo "   wrangler d1 execute photos-db-local --local --file=./migrations/003_optional_passwords.sql"
echo "   wrangler d1 execute photos-db-local --local --file=./migrations/004_enhanced_features.sql"
echo "   wrangler d1 execute photos-db-local --local --file=./migrations/002_admin_improvements.sql"
echo ""
echo "   OR run them all at once:"
echo "   for file in ./migrations/*.sql; do wrangler d1 execute photos-db-local --local --file=\"\$file\"; done"
echo ""
echo "3. Set secrets (optional for local dev):"
echo "   cd apps/worker"
echo "   wrangler secret put EVENT_COOKIE_SECRET --env development"
echo "   wrangler secret put ADMIN_SHARED_SECRET --env development"
echo "   cd ../.."
echo ""
echo "4. Start development servers:"
echo "   Terminal 1: cd apps/worker && npm run dev"
echo "   Terminal 2: cd apps/web && npm run dev"
echo ""
echo "5. Access the app:"
echo "   Web UI: http://localhost:3000"
echo "   Admin:  http://localhost:3000/admin (requires ADMIN_SHARED_SECRET in dev)"
echo ""
echo "📝 Note: For production deployment, use --remote instead of --local"
echo "    wrangler d1 execute photos-db --remote --file=./migrations/[filename].sql"
