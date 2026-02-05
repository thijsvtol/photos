# Infrastructure as Code for Cloudflare

This directory contains the infrastructure configuration and deployment automation for the thijsvtol.nl Cloudflare setup.

## Overview

Instead of manually clicking through the Cloudflare UI, all infrastructure is now defined as code using:
- **Configuration File**: `cloudflare-config.json` - Single source of truth for all settings
- **Deployment Script**: `deploy.sh` - Automated provisioning script
- **GitHub Actions**: Automated CI/CD pipelines
- **Wrangler Configuration**: Worker-specific settings in `wrangler.toml`

## Quick Start

### Prerequisites

1. Install required tools:
```bash
npm install -g wrangler
# On macOS: brew install jq
# On Ubuntu/Debian: sudo apt-get install jq
```

2. Authenticate with Cloudflare:
```bash
wrangler login
```

3. Set environment variables:
```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id-here"
export CLOUDFLARE_API_TOKEN="your-api-token-here"  # Optional, wrangler login handles this
```

### Initial Deployment

1. Review and customize `cloudflare-config.json`:
```bash
cd infrastructure
cat cloudflare-config.json
```

2. Update the `allowed_emails` field with admin email addresses

3. Run the deployment script:
```bash
./deploy.sh
```

The script will:
- ✅ Create R2 bucket for photo storage
- ✅ Create D1 database
- ✅ Run all database migrations
- ✅ Build and deploy the Worker
- ✅ Save deployment state for future runs

4. Set worker secrets (one-time):
```bash
cd ../subdomains/photos
wrangler secret put EVENT_COOKIE_SECRET --env production
# Enter a strong random value (generate with: openssl rand -base64 32)
```

5. Configure Cloudflare Pages (via dashboard or API):
   - Project name: `photos-web`
   - Production branch: `main`
   - Build command: `npm install && npm run build`
   - Build output: `dist`
   - Root directory: `subdomains/photos/apps/web`
   - Add custom domain: `photos.thijsvtol.nl`

6. Configure Cloudflare Access (via dashboard):
   - Navigate to Zero Trust → Access → Applications
   - Create application for `photos.thijsvtol.nl`
   - Protect paths: `/admin` and `/admin/*`
   - Add email allow policy with addresses from config

## Configuration File

The `cloudflare-config.json` file is the single source of truth. All settings are documented:

```json
{
  "project_name": "Name used for organization",
  "domain": {
    "zone": "Your main domain",
    "subdomain": "Subdomain for the app"
  },
  "storage": {
    "r2_bucket": "Bucket name for R2 storage",
    "location_hint": "Geographic location (WEUR, ENAM, etc.)"
  },
  "database": {
    "d1_name": "Database name",
    "migration_path": "Path to SQL migration files"
  },
  "worker": {
    "name": "Worker script name",
    "source_dir": "Path to worker source code",
    "routes": ["URL patterns handled by worker"],
    "secrets": ["Secret names (set via wrangler)"],
    "environment_vars": {"ENV": "value"}
  },
  "pages": {
    "project_name": "Pages project identifier",
    "source_dir": "Frontend source directory",
    "build_command": "Build command",
    "build_output": "Output directory"
  },
  "access": {
    "application_name": "Access app display name",
    "protected_paths": ["Paths requiring authentication"],
    "allowed_emails": ["admin@example.com"]
  }
}
```

## Deployment State

The script maintains state in `.deployment-state.json` to track:
- Resource IDs (database, bucket, worker)
- Previous deployments
- Idempotent operations

**Important**: Add `.deployment-state.json` to `.gitignore` locally, but it's saved as a CI artifact.

## GitHub Actions Automation

### Automatic Deployment on Push

When code is pushed to `main` branch:
1. Worker is automatically built and deployed
2. Changes are live within minutes

### Manual Workflows

Trigger from GitHub Actions tab:

**Deploy Worker Only**:
```
Actions → Deploy Photos Application → Run workflow
- Deploy Worker: ✅
- Run Migrations: ❌
```

**Run Migrations**:
```
Actions → Deploy Photos Application → Run workflow
- Deploy Worker: ❌
- Run Migrations: ✅
```

**Full Infrastructure Provisioning**:
```
Actions → Deploy Photos Application → Run workflow
- This runs the complete deploy.sh script
```

### Required Secrets

Add these in GitHub repository settings → Secrets and variables → Actions:

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `CLOUDFLARE_API_TOKEN` | API token with Worker, Pages, D1, R2 permissions | Dashboard → My Profile → API Tokens → Create Token |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Dashboard → Workers → Account ID |

## Manual Operations

### Deploy Worker Manually

```bash
cd subdomains/photos
npm --prefix apps/worker install
npm --prefix apps/worker run build
wrangler deploy --env production
```

### Run Migrations Manually

```bash
cd subdomains/photos
for file in migrations/*.sql; do
  wrangler d1 execute photos-db --remote --file="$file"
done
```

### Create R2 Bucket Manually

```bash
wrangler r2 bucket create photos-storage --location WEUR
```

### Create D1 Database Manually

```bash
wrangler d1 create photos-db
# Copy the database ID to wrangler.toml
```

### Check Resource Status

```bash
# List R2 buckets
wrangler r2 bucket list

# List D1 databases
wrangler d1 list

# Query database
wrangler d1 execute photos-db --remote --command "SELECT COUNT(*) FROM events"

# Check deployed workers
wrangler deployments list
```

## Updating Infrastructure

### Modify Settings

1. Edit `cloudflare-config.json`
2. Run `./deploy.sh` to apply changes
3. Commit the configuration file

### Add New Resources

1. Update `cloudflare-config.json` with new resource definition
2. Extend `deploy.sh` with provisioning logic
3. Test locally, then commit

### Rollback

The deployment state file tracks previous configurations:
```bash
# View current state
cat .deployment-state.json

# Restore from backup
cp .deployment-state.json.backup .deployment-state.json
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                  GitHub Repository                   │
│  - Source Code                                      │
│  - Infrastructure Config (cloudflare-config.json)   │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│              GitHub Actions (CI/CD)                  │
│  - Build Worker                                     │
│  - Run Migrations                                   │
│  - Deploy Infrastructure                            │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│                Cloudflare Platform                   │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                │
│  │ Pages        │  │ Workers      │                │
│  │ (Frontend)   │  │ (API)        │                │
│  └──────────────┘  └──────────────┘                │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                │
│  │ D1 Database  │  │ R2 Storage   │                │
│  │ (SQLite)     │  │ (Photos)     │                │
│  └──────────────┘  └──────────────┘                │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                │
│  │ DNS/CDN      │  │ Access       │                │
│  │ (Proxy)      │  │ (Auth)       │                │
│  └──────────────┘  └──────────────┘                │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│           Users (photos.thijsvtol.nl)                │
└─────────────────────────────────────────────────────┘
```

## Troubleshooting

### Script Fails with "wrangler not found"

```bash
npm install -g wrangler
```

### Permission Denied Errors

```bash
chmod +x deploy.sh
```

### API Authentication Issues

```bash
wrangler login
# Or set CLOUDFLARE_API_TOKEN environment variable
```

### Database Already Exists

The script is idempotent - it will detect existing resources and skip creation.

### Migration Errors

Migrations are safe to run multiple times. The script catches errors from already-applied migrations.

## Best Practices

1. **Version Control**: Always commit `cloudflare-config.json` changes
2. **Secrets**: Never commit secrets - use `wrangler secret` or GitHub Secrets
3. **Testing**: Test infrastructure changes in a separate account first
4. **Documentation**: Update this README when adding new resources
5. **State Management**: Back up `.deployment-state.json` after successful deployments

## Additional Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Cloudflare Access Documentation](https://developers.cloudflare.com/cloudflare-one/applications/)

## License

Proprietary - Thijs van Tol
