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

### For New Infrastructure

If you're creating resources from scratch:

```bash
# 1. Configure
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars  # Add your API token and account ID

# 2. Deploy
terraform init      # Download provider
terraform plan      # Preview changes
terraform apply     # Create resources

# 3. Run Migrations
./run-migrations.sh

# 4. Deploy Worker
cd ../subdomains/photos/apps/worker
npm install && npm run build
cd ../..
wrangler deploy --env production
```

### For Existing Infrastructure

If you already have resources deployed, see [Importing Existing Resources](#importing-existing-resources) below.

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

## Importing Existing Resources

If you already have Cloudflare resources deployed and want to manage them with Terraform, you need to import them into Terraform state.

### Prerequisites

1. Configure your `terraform.tfvars` file
2. Run `terraform init`
3. Gather your resource IDs (see below for how to find them)

### Step-by-Step Import Process

**1. Find Your Resource IDs**

```bash
# Get your account ID from Cloudflare Dashboard → Workers → Account ID
export CLOUDFLARE_ACCOUNT_ID="your-account-id"

# List R2 buckets
wrangler r2 bucket list

# List D1 databases
wrangler d1 list
# Note the database UUID from the output

# Get zone ID (for DNS and routes)
# Go to Cloudflare Dashboard → Your Domain → Overview → Zone ID
```

**2. Import Resources One by One**

Import each resource using the `terraform import` command:

```bash
# Import R2 Bucket
terraform import cloudflare_r2_bucket.photos_storage $CLOUDFLARE_ACCOUNT_ID/photos-storage

# Import D1 Database
terraform import cloudflare_d1_database.photos_db $CLOUDFLARE_ACCOUNT_ID/<database-uuid>

# Import Worker Script
terraform import cloudflare_worker_script.photos_worker $CLOUDFLARE_ACCOUNT_ID/photos-worker

# Import Worker Routes (get route IDs from dashboard)
terraform import cloudflare_worker_route.photos_api <zone-id>/<route-id>
terraform import cloudflare_worker_route.photos_media <zone-id>/<route-id>

# Import DNS Record (get record ID from dashboard)
terraform import cloudflare_record.photos_subdomain <zone-id>/<record-id>
```

**3. Verify State**

```bash
# List imported resources
terraform state list

# Show details of a specific resource
terraform state show cloudflare_r2_bucket.photos_storage
```

**4. Test Configuration**

```bash
# Verify Terraform matches existing infrastructure
terraform plan

# Should show: "No changes. Your infrastructure matches the configuration."
```

### Finding Resource IDs

**Worker Route IDs:**
```bash
# Use Cloudflare API
curl -X GET "https://api.cloudflare.com/client/v4/zones/<zone-id>/workers/routes" \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json"
```

**DNS Record IDs:**
```bash
# Use Cloudflare API
curl -X GET "https://api.cloudflare.com/client/v4/zones/<zone-id>/dns_records?name=photos.thijsvtol.nl" \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json"
```

**D1 Database UUID:**
```bash
# From wrangler output
wrangler d1 list --json | jq -r '.[] | select(.name=="photos-db") | .uuid'
```

### Import Script Example

Create a file `import-resources.sh`:

```bash
#!/bin/bash
set -e

# Configuration
ACCOUNT_ID="your-account-id"
ZONE_ID="your-zone-id"
DB_UUID="your-database-uuid"
API_ROUTE_ID="your-api-route-id"
MEDIA_ROUTE_ID="your-media-route-id"
DNS_RECORD_ID="your-dns-record-id"

# Import resources
echo "Importing R2 bucket..."
terraform import cloudflare_r2_bucket.photos_storage $ACCOUNT_ID/photos-storage

echo "Importing D1 database..."
terraform import cloudflare_d1_database.photos_db $ACCOUNT_ID/$DB_UUID

echo "Importing Worker script..."
terraform import cloudflare_worker_script.photos_worker $ACCOUNT_ID/photos-worker

echo "Importing Worker routes..."
terraform import cloudflare_worker_route.photos_api $ZONE_ID/$API_ROUTE_ID
terraform import cloudflare_worker_route.photos_media $ZONE_ID/$MEDIA_ROUTE_ID

echo "Importing DNS record..."
terraform import cloudflare_record.photos_subdomain $ZONE_ID/$DNS_RECORD_ID

echo "Import complete! Run 'terraform plan' to verify."
```

### Troubleshooting Imports

**"Resource already exists in state"**
```bash
# Remove from state first
terraform state rm cloudflare_r2_bucket.photos_storage
# Then re-import
terraform import cloudflare_r2_bucket.photos_storage $ACCOUNT_ID/photos-storage
```

**"Resource not found"**
- Verify the resource exists in Cloudflare Dashboard
- Double-check IDs are correct
- Ensure API token has necessary permissions

**Configuration doesn't match**
After importing, if `terraform plan` shows changes, update your `terraform.tfvars` or `main.tf` to match the actual resource configuration.

## Benefits

- **74% less code** (800 → 210 lines)
- **Native state management** (no custom JSON)
- **Automatic dependencies** (Terraform handles ordering)
- **Drift detection** (detect manual changes)
- **Industry standard** (extensive community support)

## File Structure

```
infrastructure/
├── main.tf                  # Resource definitions
├── variables.tf             # Input variables
├── outputs.tf               # Output values
├── terraform.tfvars.example # Config template
├── run-migrations.sh        # DB migrations
└── .terraform-version       # Terraform version pin
```

## Common Issues

**"Worker build missing"**
```bash
# Build worker before terraform apply
cd ../subdomains/photos/apps/worker
npm install && npm run build
```

**"Error: Resource already exists in state"**
See [Importing Existing Resources](#importing-existing-resources) section above.

## Documentation

- [Terraform Docs](https://www.terraform.io/docs)
- [Cloudflare Provider](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs)
- [Terraform Import Command](https://www.terraform.io/cli/import)
