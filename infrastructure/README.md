# Cloudflare Infrastructure - Terraform

Manage Cloudflare resources with Terraform - 74% less code than bash scripts.

## Prerequisites

1. **Terraform** (>= 1.0)
   ```bash
   # macOS: brew install terraform
   # Linux: Download from terraform.io
   ```

2. **Wrangler CLI** (for worker deployment)
   ```bash
   npm install -g wrangler
   wrangler login
   ```

## Quick Start

### 1. Configure

```bash
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars  # Add your API token and account ID
```

### 2. Deploy

```bash
terraform init      # Download provider
terraform plan      # Preview changes
terraform apply     # Create resources
```

### 3. Run Migrations

```bash
./run-migrations.sh
```

### 4. Deploy Worker

```bash
cd ../subdomains/photos/apps/worker
npm install && npm run build
cd ../..
wrangler deploy --env production
```

## Resources Managed

- **R2 Bucket** - Photo storage
- **D1 Database** - SQLite database  
- **Worker Script** - Backend API
- **Worker Routes** - API/media endpoints
- **DNS Records** - Subdomain CNAME

## Common Commands

```bash
terraform show                      # View current state
terraform output                    # Show outputs
terraform output d1_database_id     # Get database ID
terraform apply                     # Update infrastructure
terraform destroy                   # Delete all resources
```

## Benefits

- **74% less code** (800 → 210 lines)
- **Native state management** (no custom JSON)
- **Automatic dependencies** (Terraform handles ordering)
- **Drift detection** (detect manual changes)
- **Industry standard** (extensive community support)

## Migration from Bash

Old scripts archived in `legacy/`:

| Old Command | New Command |
|-------------|-------------|
| `./deploy.sh` | `terraform apply` |
| `./status.sh` | `terraform show` |
| `./destroy.sh` | `terraform destroy` |
| `cloudflare-config.json` | `terraform.tfvars` |

## File Structure

```
infrastructure/
├── main.tf                  # Resource definitions
├── variables.tf             # Input variables
├── outputs.tf               # Output values
├── terraform.tfvars.example # Config template
├── run-migrations.sh        # DB migrations
└── legacy/                  # Old bash scripts
```

## Troubleshooting

**"Resource already exists"**
```bash
# Import existing resources
terraform import cloudflare_r2_bucket.photos_storage <account_id>/photos-storage
```

**"Worker build missing"**
```bash
# Build worker before terraform apply
cd ../subdomains/photos/apps/worker
npm install && npm run build
```

## Documentation

- [Terraform Docs](https://www.terraform.io/docs)
- [Cloudflare Provider](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs)
- See `legacy/` for old bash documentation
