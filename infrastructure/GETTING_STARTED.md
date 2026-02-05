# Getting Started with Infrastructure as Code

This guide will help you transition from manual Cloudflare UI configuration to fully automated Infrastructure as Code.

## What Changed?

**Before:** You clicked through Cloudflare Dashboard to create resources manually  
**Now:** All resources are defined in code and deployed automatically

## Benefits

✅ **Version Control**: Track all infrastructure changes in Git  
✅ **Reproducible**: Recreate entire setup with one command  
✅ **Documented**: Configuration file serves as documentation  
✅ **Automated**: GitHub Actions handles deployments  
✅ **Consistent**: No manual configuration drift  
✅ **Auditable**: Full history of infrastructure changes  

## Prerequisites

Before you begin, ensure you have:

1. **Wrangler CLI** installed:
   ```bash
   npm install -g wrangler
   ```

2. **Cloudflare Authentication**:
   ```bash
   wrangler login
   ```
   This opens a browser to authenticate with Cloudflare.

3. **Cloudflare Account ID**:
   - Go to Cloudflare Dashboard → Workers & Pages
   - Copy your Account ID from the sidebar
   - Set it as an environment variable:
     ```bash
     export CLOUDFLARE_ACCOUNT_ID="your-account-id"
     ```

4. **jq** for JSON parsing (Linux/Mac):
   ```bash
   # macOS
   brew install jq
   
   # Ubuntu/Debian
   sudo apt-get install jq
   ```

## Step 1: Review Configuration

Open and customize the configuration file:

```bash
cd infrastructure
cat cloudflare-config.json
```

Update these key fields:
- `domain.zone`: Your main domain (e.g., "thijsvtol.nl")
- `domain.subdomain`: Subdomain for photos app (e.g., "photos")
- `access.allowed_emails`: List of admin email addresses

Example:
```json
{
  "domain": {
    "zone": "thijsvtol.nl",
    "subdomain": "photos"
  },
  "access": {
    "allowed_emails": ["admin@example.com", "user@example.com"]
  }
}
```

## Step 2: Run Initial Deployment

Execute the deployment script:

```bash
./deploy.sh
```

This will:
1. ✅ Create R2 bucket named "photos-storage"
2. ✅ Create D1 database named "photos-db"
3. ✅ Execute all database migrations
4. ✅ Build and deploy the Worker
5. ✅ Save deployment state

**Expected Output:**
```
[INFO] Checking prerequisites...
[SUCCESS] All prerequisites met
[INFO] Setting up R2 bucket: photos-storage
[SUCCESS] R2 bucket 'photos-storage' already exists
[INFO] Setting up D1 database: photos-db
[INFO] Creating new D1 database: photos-db
[SUCCESS] Created D1 database with ID: abc123...
[INFO] Running database migrations...
[SUCCESS] Database migrations completed
[INFO] Building and deploying worker: photos-worker
[SUCCESS] Worker deployed successfully
```

## Step 3: Set Worker Secrets

Worker secrets cannot be stored in code for security. Set them manually:

```bash
cd ../subdomains/photos
wrangler secret put EVENT_COOKIE_SECRET --env production
```

When prompted, enter a strong random secret:
```bash
# Generate a secure secret:
openssl rand -base64 32
```

## Step 4: Update Wrangler Configuration

The deployment script outputs a database ID. Update `wrangler.toml`:

```bash
cd ../subdomains/photos
nano wrangler.toml
```

Find the `database_id` field and update it with the ID from deployment output.

**Or use this one-liner:**
```bash
DB_ID=$(jq -r '.d1_database_id' ../../infrastructure/.deployment-state.json)
sed -i "s/database_id = .*/database_id = \"$DB_ID\"/" wrangler.toml
```

## Step 5: Setup Cloudflare Pages

### Option A: Via Dashboard (Recommended for First Time)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages
2. Click **Create** → **Pages** → **Connect to Git**
3. Select your repository: `thijsvtol/thijsvtol-site`
4. Configure build settings:
   - **Project name**: `photos-web`
   - **Production branch**: `main`
   - **Build command**: `npm install && npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `subdomains/photos/apps/web`
5. Click **Save and Deploy**
6. Go to **Custom domains** → Add `photos.thijsvtol.nl`

### Option B: Via Wrangler (Advanced)

```bash
# Coming soon - Pages deployment via Wrangler
```

## Step 6: Configure Cloudflare Access

Protect admin routes with authentication:

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. Navigate to **Access** → **Applications** → **Add an application**
3. Select **Self-hosted**
4. Configure:
   - **Application name**: Photos Admin Portal
   - **Application domain**: `photos.thijsvtol.nl`
   - **Path**: `/admin` and `/admin/*`
5. Add a policy:
   - **Policy name**: Admin Access
   - **Action**: Allow
   - **Include**: Emails → Add addresses from your config
6. Save the application

## Step 7: Verify Deployment

Check that everything is working:

```bash
cd infrastructure
./status.sh
```

This shows the status of all resources:
- ✅ R2 bucket exists
- ✅ D1 database exists with tables
- ✅ Worker is deployed
- ✅ DNS configuration

## Step 8: Setup GitHub Actions (Optional but Recommended)

Enable automatic deployments on code changes.

### Add GitHub Secrets

1. Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add:

| Secret Name | Value | Where to Find |
|-------------|-------|---------------|
| `CLOUDFLARE_API_TOKEN` | Your API token | Dashboard → Profile → API Tokens → Create Token |
| `CLOUDFLARE_ACCOUNT_ID` | Your account ID | Dashboard → Workers → Copy Account ID |

### Create API Token

For the API token:
1. Go to Cloudflare Dashboard → My Profile → API Tokens
2. Click **Create Token**
3. Use "Edit Cloudflare Workers" template
4. Add these permissions:
   - Account → D1 → Edit
   - Account → Cloudflare Pages → Edit
   - Account → Workers R2 Storage → Edit
   - Zone → Workers Routes → Edit
5. Click **Continue to summary** → **Create Token**
6. Copy the token (you won't see it again!)

### Test GitHub Actions

1. Make a small change to code
2. Commit and push to `main` branch
3. Go to GitHub → **Actions** tab
4. Watch the deployment workflow run

## Verification Checklist

After completing all steps, verify:

- [ ] R2 bucket exists and is accessible
- [ ] D1 database has all tables (events, photos, tags, event_tags)
- [ ] Worker is deployed and responds to requests
- [ ] Pages project is deployed and accessible
- [ ] Custom domain `photos.thijsvtol.nl` works
- [ ] Admin routes require authentication
- [ ] GitHub Actions workflow runs successfully
- [ ] `infrastructure/status.sh` shows all resources as healthy

## Common Issues

### "wrangler: command not found"
```bash
npm install -g wrangler
```

### "CLOUDFLARE_ACCOUNT_ID not set"
```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
# Add to ~/.bashrc or ~/.zshrc to make permanent
```

### "Database already exists"
The script is idempotent - this is normal. It will use the existing database.

### "Migration failed"
Migrations are safe to run multiple times. If a migration was already applied, you'll see a warning but it's harmless.

### Pages deployment fails
- Check that build command is correct in Pages settings
- Verify root directory is `subdomains/photos/apps/web`
- Check build logs in Pages dashboard

## Next Steps

Now that infrastructure is deployed:

1. **Test the Application**:
   ```bash
   # Visit your domain
   open https://photos.thijsvtol.nl
   ```

2. **Create First Event**:
   - Visit `/admin`
   - Authenticate via Cloudflare Access
   - Create an event and upload photos

3. **Monitor Resources**:
   ```bash
   # Check infrastructure status
   cd infrastructure
   ./status.sh
   
   # Watch worker logs in real-time
   wrangler tail --env production
   ```

4. **Make Changes**:
   - Edit code in `subdomains/photos/`
   - Push to GitHub
   - GitHub Actions automatically deploys

## Rollback Plan

If something goes wrong:

1. **Revert Code Changes**:
   ```bash
   git revert HEAD
   git push
   ```

2. **Restore from State Backup**:
   ```bash
   cd infrastructure
   cp .deployment-state.json.backup .deployment-state.json
   ```

3. **Manual Recovery**:
   - Check Cloudflare Dashboard for resources
   - Worker logs: `wrangler tail --env production`
   - Database query: `wrangler d1 execute photos-db --remote --command "SELECT * FROM events"`

## Learning Resources

- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Database](https://developers.cloudflare.com/d1/)
- [Cloudflare R2 Storage](https://developers.cloudflare.com/r2/)
- [Cloudflare Pages](https://developers.cloudflare.com/pages/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)

## Getting Help

If you run into issues:

1. Check the logs:
   ```bash
   wrangler tail --env production
   ```

2. Review infrastructure status:
   ```bash
   cd infrastructure
   ./status.sh
   ```

3. Check GitHub Actions logs (if using CI/CD)

4. Consult the detailed README files:
   - `infrastructure/README.md` - Infrastructure documentation
   - `subdomains/photos/README.md` - Application documentation

## Summary

You've successfully transitioned from manual UI configuration to Infrastructure as Code! 🎉

Your setup now includes:
- ✅ All resources defined in `cloudflare-config.json`
- ✅ One-command deployment via `deploy.sh`
- ✅ Automatic deployments via GitHub Actions
- ✅ Status monitoring via `status.sh`
- ✅ Full version control of infrastructure

Every change is now tracked in Git, reproducible, and automated.
