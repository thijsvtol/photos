output "r2_bucket_name" {
  description = "Name of the R2 bucket"
  value       = cloudflare_r2_bucket.photos_storage.name
}

output "d1_database_id" {
  description = "ID of the D1 database (use in wrangler.toml)"
  value       = cloudflare_d1_database.photos_db.id
}

output "d1_database_name" {
  description = "Name of the D1 database"
  value       = cloudflare_d1_database.photos_db.name
}

output "worker_name" {
  description = "Name of the Worker script"
  value       = cloudflare_worker_script.photos_worker.name
}

output "subdomain_url" {
  description = "Full URL of the photos subdomain"
  value       = "https://${var.subdomain}.${var.domain_zone}"
}

output "zone_id" {
  description = "Cloudflare Zone ID"
  value       = data.cloudflare_zone.main.id
}
