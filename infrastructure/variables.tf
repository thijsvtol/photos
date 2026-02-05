variable "cloudflare_api_token" {
  description = "Cloudflare API token for authentication"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
  sensitive   = true
}

variable "domain_zone" {
  description = "Main domain zone (e.g., thijsvtol.nl)"
  type        = string
  default     = "thijsvtol.nl"
}

variable "subdomain" {
  description = "Subdomain for the photos application"
  type        = string
  default     = "photos"
}

variable "r2_bucket_name" {
  description = "Name of the R2 bucket for photo storage"
  type        = string
  default     = "photos-storage"
}

variable "r2_location" {
  description = "R2 bucket location hint"
  type        = string
  default     = "WEUR"
}

variable "d1_database_name" {
  description = "Name of the D1 database"
  type        = string
  default     = "photos-db"
}

variable "worker_name" {
  description = "Name of the Cloudflare Worker"
  type        = string
  default     = "photos-worker"
}

variable "worker_compatibility_date" {
  description = "Worker compatibility date"
  type        = string
  default     = "2024-09-23"
}
