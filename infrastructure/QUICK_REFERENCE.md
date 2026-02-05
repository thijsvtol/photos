# Infrastructure as Code - Quick Reference

## Essential Commands

### Initial Setup
```bash
# 1. Authenticate with Cloudflare
wrangler login

# 2. Set your account ID
export CLOUDFLARE_ACCOUNT_ID="your-account-id"

# 3. Run pre-flight checks
cd infrastructure
./preflight.sh

# 4. Deploy infrastructure
./deploy.sh
```

### Deployment
```bash
# Deploy everything
cd infrastructure && ./deploy.sh

# Deploy worker only
cd subdomains/photos && wrangler deploy --env production

# Run migrations
cd subdomains/photos
for f in migrations/*.sql; do
  wrangler d1 execute photos-db --remote --file="$f"
done
```

### Monitoring
```bash
# Check infrastructure status
cd infrastructure && ./status.sh

# Watch worker logs in real-time
wrangler tail --env production

# List deployments
wrangler deployments list
```

### Secrets Management
```bash
# Set worker secrets (one-time)
cd subdomains/photos
wrangler secret put EVENT_COOKIE_SECRET --env production

# List secrets (names only, not values)
wrangler secret list --env production
```

### Database Operations
```bash
# List databases
wrangler d1 list

# Query database
wrangler d1 execute photos-db --remote --command "SELECT * FROM events"

# Export database
wrangler d1 export photos-db --remote --output=backup.sql

# Check table schema
wrangler d1 execute photos-db --remote --command "PRAGMA table_info(photos)"
```

### R2 Storage Operations
```bash
# List buckets
wrangler r2 bucket list

# List objects in bucket
wrangler r2 object list photos-storage

# Get object info
wrangler r2 object get photos-storage original/event-slug/photo-id.jpg
```

### GitHub Actions
```bash
# Trigger manual deployment
gh workflow run deploy-photos.yml

# View workflow runs
gh run list --workflow=deploy-photos.yml

# Watch workflow run
gh run watch
```

## Configuration Files

| File | Purpose |
|------|---------|
| `infrastructure/cloudflare-config.json` | All resource definitions |
| `subdomains/photos/wrangler.toml` | Worker configuration |
| `.github/workflows/deploy-photos.yml` | CI/CD pipeline |
| `infrastructure/.deployment-state.json` | Deployment state (gitignored) |

## Common Tasks

### Update Worker Code
```bash
cd subdomains/photos/apps/worker
npm install          # Install dependencies
npm run build        # Build TypeScript
cd ../..
wrangler deploy --env production
```

### Update Frontend
```bash
cd subdomains/photos/apps/web
npm install
npm run build
# Deploy via Cloudflare Pages dashboard or automatic git push
```

### Add New Admin Email
```bash
cd infrastructure
# Edit cloudflare-config.json
nano cloudflare-config.json  # Add email to .access.allowed_emails
# Update Cloudflare Access via dashboard
```

### Create Database Backup
```bash
wrangler d1 export photos-db --remote --output="backup-$(date +%Y%m%d).sql"
```

### Rollback Deployment
```bash
# View previous deployments
wrangler deployments list

# Rollback to specific version
wrangler rollback --message "Rollback to previous version"
```

## Resource IDs

After deployment, find resource IDs in:
```bash
# View deployment state
cat infrastructure/.deployment-state.json

# Or extract specific values
jq -r '.d1_database_id' infrastructure/.deployment-state.json
jq -r '.r2_bucket' infrastructure/.deployment-state.json
```

## Troubleshooting

### Check All Resources
```bash
./infrastructure/status.sh
```

### Worker Not Responding
```bash
wrangler tail --env production  # Watch logs
wrangler deployments list       # Check if deployed
```

### Database Issues
```bash
# Verify database exists
wrangler d1 list

# Check tables
wrangler d1 execute photos-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"

# Re-run migrations
cd subdomains/photos
for f in migrations/*.sql; do
  wrangler d1 execute photos-db --remote --file="$f"
done
```

### Authentication Issues
```bash
# Re-authenticate
wrangler login

# Check current user
wrangler whoami

# Verify account ID
echo $CLOUDFLARE_ACCOUNT_ID
```

## File Locations

```
thijsvtol-site/
├── infrastructure/
│   ├── cloudflare-config.json    # Main configuration
│   ├── deploy.sh                 # Deployment script
│   ├── status.sh                 # Status checker
│   ├── preflight.sh              # Pre-flight checks
│   ├── destroy.sh                # Cleanup script
│   ├── README.md                 # Full documentation
│   └── GETTING_STARTED.md        # Setup guide
├── subdomains/photos/
│   ├── wrangler.toml             # Worker config
│   ├── migrations/               # SQL migrations
│   ├── apps/worker/              # Backend code
│   └── apps/web/                 # Frontend code
└── .github/workflows/
    └── deploy-photos.yml         # CI/CD pipeline
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | No | API token (or use `wrangler login`) |

## GitHub Secrets (for CI/CD)

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | API access for GitHub Actions |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID for deployments |

## URLs

- **Dashboard**: https://dash.cloudflare.com
- **Zero Trust**: https://one.dash.cloudflare.com
- **Pages**: https://dash.cloudflare.com → Workers & Pages → Pages
- **Workers**: https://dash.cloudflare.com → Workers & Pages → Overview
- **R2**: https://dash.cloudflare.com → R2
- **D1**: https://dash.cloudflare.com → D1

## Emergency Procedures

### Complete Infrastructure Teardown
```bash
cd infrastructure
./destroy.sh  # Interactive, asks for confirmation
```

### Restore from Backup
```bash
# Restore database
wrangler d1 execute photos-db --remote --file=backup.sql

# Restore deployment state
cp infrastructure/.deployment-state.json.backup infrastructure/.deployment-state.json
```

### Force Re-deploy Everything
```bash
cd infrastructure
rm .deployment-state.json  # Remove state
./deploy.sh                # Re-provision everything
```

## Best Practices

1. ✅ Always run `./preflight.sh` before deploying
2. ✅ Commit `cloudflare-config.json` changes to git
3. ✅ Never commit secrets or `.deployment-state.json`
4. ✅ Test changes locally with `wrangler dev` first
5. ✅ Use GitHub Actions for production deployments
6. ✅ Back up database before major changes
7. ✅ Monitor logs after deployment
8. ✅ Keep wrangler updated: `npm update -g wrangler`

## Getting Help

- Full docs: `cat infrastructure/README.md`
- Setup guide: `cat infrastructure/GETTING_STARTED.md`
- Worker logs: `wrangler tail --env production`
- Status check: `./infrastructure/status.sh`
- Cloudflare docs: https://developers.cloudflare.com/

---

**Quick Start**: `cd infrastructure && ./preflight.sh && ./deploy.sh`
