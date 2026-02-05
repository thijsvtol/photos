terraform {
  required_version = "~> 1.6.0"
  
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
  
  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Data source to get the zone
data "cloudflare_zone" "main" {
  name = var.domain_zone
}

# R2 Bucket for photo storage
resource "cloudflare_r2_bucket" "photos_storage" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name
  location   = var.r2_location
}

# D1 Database for photos
resource "cloudflare_d1_database" "photos_db" {
  account_id = var.cloudflare_account_id
  name       = var.d1_database_name
}

# Worker script (Note: script content must be built separately)
resource "cloudflare_worker_script" "photos_worker" {
  account_id = var.cloudflare_account_id
  name       = var.worker_name
  content    = file("${path.module}/../subdomains/photos/apps/worker/dist/index.js")

  d1_database_binding {
    name        = "DB"
    database_id = cloudflare_d1_database.photos_db.id
  }

  r2_bucket_binding {
    name        = "PHOTOS_BUCKET"
    bucket_name = cloudflare_r2_bucket.photos_storage.name
  }

  plain_text_binding {
    name = "ENVIRONMENT"
    text = "production"
  }

  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = ["nodejs_compat"]

  lifecycle {
    # Worker content is deployed separately via wrangler CLI,
    # so Terraform should ignore content changes to prevent
    # drift detection conflicts during normal worker updates
    ignore_changes = [
      content,
    ]
  }
}

# Worker routes for API endpoints
resource "cloudflare_worker_route" "photos_api" {
  zone_id     = data.cloudflare_zone.main.id
  pattern     = "${var.subdomain}.${var.domain_zone}/api/*"
  script_name = cloudflare_worker_script.photos_worker.name
}

resource "cloudflare_worker_route" "photos_media" {
  zone_id     = data.cloudflare_zone.main.id
  pattern     = "${var.subdomain}.${var.domain_zone}/media/*"
  script_name = cloudflare_worker_script.photos_worker.name
}

# DNS CNAME record for subdomain
resource "cloudflare_record" "photos_subdomain" {
  zone_id = data.cloudflare_zone.main.id
  name    = var.subdomain
  value   = var.domain_zone
  type    = "CNAME"
  proxied = true
  comment = "Managed by Terraform"
}
