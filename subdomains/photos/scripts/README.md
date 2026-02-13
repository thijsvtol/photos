# Setup Scripts

This directory contains helper scripts for setting up and deploying the photo sharing application.

## Available Scripts

### 🧙 setup-wizard.js

Interactive setup wizard that guides you through initial configuration.

```bash
npm run setup:wizard
```

**What it does:**
- Prompts for all required configuration values
- Generates `.dev.vars` for worker
- Generates `.env.local` for web app
- Creates secure random secrets
- Validates email and domain formats

**When to use:**
- First time setup
- Resetting configuration
- Creating new deployment

---

### ✅ validate-config.js

Validates your configuration files and checks for common issues.

```bash
npm run validate
```

**What it does:**
- Checks `.dev.vars` exists and has required values
- Checks `.env.local` exists and has required values
- Validates wrangler.toml configuration
- Checks dependencies are installed
- Reports errors and warnings

**When to use:**
- After running setup wizard
- Before starting development
- Troubleshooting configuration issues
- Before deployment

---

### 🗄️ db-setup.sh

Sets up local D1 database and runs migrations.

```bash
npm run db:setup
```

**What it does:**
- Creates local D1 database
- Runs all SQL migrations in order
- Verifies database tables were created
- Provides troubleshooting guidance

**When to use:**
- After initial setup
- When adding new migrations
- Resetting local database
- Troubleshooting database issues

**Requirements:**
- Wrangler CLI installed (`npm install -g wrangler`)
- Migration files in `./migrations/` directory

---

### 🚀 deploy-helper.sh

Interactive deployment helper for production.

```bash
npm run deploy:helper
```

**What it does:**
- Checks Cloudflare authentication
- Creates production D1 database
- Runs production migrations
- Creates R2 bucket
- Sets production secrets
- Deploys worker

**Options:**
1. Set up production database only
2. Create R2 bucket only
3. Configure secrets only
4. Deploy worker only
5. Full deployment (all of the above)

**When to use:**
- First production deployment
- Deploying updates
- Setting up new resources
- Troubleshooting production issues

**Requirements:**
- Wrangler CLI installed and logged in
- `.dev.vars` configured with production values
- `wrangler.toml` configured

---

## Quick Start Workflow

### First Time Setup

1. **Run setup wizard:**
   ```bash
   npm run setup:wizard
   ```

2. **Validate configuration:**
   ```bash
   npm run validate
   ```

3. **Set up database:**
   ```bash
   npm run db:setup
   ```

4. **Install dependencies:**
   ```bash
   npm run install:all
   ```

5. **Start development:**
   ```bash
   npm run dev
   ```

### Production Deployment

1. **Validate configuration:**
   ```bash
   npm run validate
   ```

2. **Run deployment helper:**
   ```bash
   npm run deploy:helper
   ```

3. **Follow prompts** to deploy resources

4. **Deploy frontend** to Cloudflare Pages (see CONFIGURATION.md)

---

## Troubleshooting

### Scripts Won't Execute

Make sure scripts are executable:
```bash
chmod +x scripts/*.sh scripts/*.js
```

### Wrangler Not Found

Install Wrangler CLI globally:
```bash
npm install -g wrangler
```

### Configuration Errors

Run validation to see specific issues:
```bash
npm run validate
```

### Database Issues

Reset local database:
```bash
rm -rf .wrangler/state
npm run db:setup
```

### Node Version

Requires Node.js 18 or higher:
```bash
node --version
```

---

## Manual Execution

You can also run scripts directly:

```bash
# Setup wizard
node scripts/setup-wizard.js

# Validation
node scripts/validate-config.js

# Database setup
bash scripts/db-setup.sh

# Deployment helper
bash scripts/deploy-helper.sh
```

---

## Script Development

### Adding New Scripts

1. Create script in `scripts/` directory
2. Make executable: `chmod +x scripts/your-script.sh`
3. Add npm script to `package.json`
4. Document in this README

### Testing Scripts

Test scripts in a clean environment:
```bash
# Backup existing config
mv .dev.vars .dev.vars.backup

# Test script
npm run setup:wizard

# Restore config
mv .dev.vars.backup .dev.vars
```

---

## Related Documentation

- [CONFIGURATION.md](../CONFIGURATION.md) - Complete configuration guide
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Development workflow
- [README.md](../README.md) - Project overview

---

## Support

If you encounter issues with these scripts:
1. Check this README for troubleshooting
2. Run `npm run validate` to diagnose issues
3. See [CONTRIBUTING.md](../CONTRIBUTING.md) for support options
