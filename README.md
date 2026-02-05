# Thijs van Tol - Site Repository

This repository contains the source code for various subdomains and applications for thijsvtol.nl.

## Structure

The repository is organized into subdomains, each containing its own application(s):

```
/
├── infrastructure/       # Infrastructure as Code (Terraform)
│   ├── main.tf           # Terraform configuration
│   ├── variables.tf      # Input variables
│   ├── outputs.tf        # Output values
│   ├── run-migrations.sh # Database migration script
│   └── README.md         # Infrastructure documentation
├── subdomains/
│   └── photos/           # photos.thijsvtol.nl - Photo gallery application
│       ├── apps/
│       │   ├── web/      # React frontend
│       │   └── worker/   # Cloudflare Worker backend
│       ├── migrations/   # Database migrations
│       └── README.md     # Detailed documentation
└── README.md             # This file
```

## Subdomains

### Photos (photos.thijsvtol.nl)

A full-stack photo gallery application with event-based organization, password protection, and admin upload capabilities.

**Tech Stack:**
- Frontend: React + Vite + Tailwind CSS
- Backend: Cloudflare Worker (TypeScript + Hono)
- Database: Cloudflare D1 (SQLite)
- Storage: Cloudflare R2 (S3-compatible)

**Features:**
- Public event galleries with password protection
- Admin dashboard for event management
- Drag & drop photo uploads with resume capability
- EXIF metadata extraction
- Multiple download formats (original, Instagram-ready)
- Batch downloads

See [subdomains/photos/README.md](./subdomains/photos/README.md) for detailed documentation and setup instructions.

## Development

Each subdomain has its own development setup. Refer to the subdomain's README for specific instructions.

## Infrastructure as Code

All Cloudflare resources are managed with **Terraform** - industry-standard infrastructure as code.

**Quick Start:**
```bash
cd infrastructure
terraform init
terraform plan
terraform apply
```

This automatically provisions:
- ✅ R2 bucket for photo storage
- ✅ D1 database
- ✅ Worker routes and configuration
- ✅ DNS records

**Benefits:**
- 90% less code than custom bash scripts
- Native state management
- Automatic dependency resolution
- Built-in drift detection

See [infrastructure/README.md](./infrastructure/README.md) for complete documentation.

**GitHub Actions:**
Automatic worker deployments on push to `main` branch. Manual Terraform workflows available for infrastructure provisioning.

## Deployment

Each subdomain is deployed independently:
- **Photos**: Cloudflare Pages (frontend) + Cloudflare Workers (backend)

All infrastructure is managed with Terraform in `infrastructure/` directory.

## License

Proprietary - Thijs van Tol
