# Thijs van Tol - Site Repository

This repository contains the source code for various subdomains and applications for thijsvtol.nl.

## Structure

The repository is organized into subdomains, each containing its own application(s):

```
/
├── subdomains/
│   └── photos/           # photos.thijsvtol.nl - Photo gallery application
│       ├── apps/
│       │   ├── web/      # React frontend
│       │   ├── worker/   # Cloudflare Worker backend
│       │   └── mobile/   # React Native mobile app
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
- Mobile: React Native + Expo (iOS/Android)

**Features:**
- Public event galleries with password protection
- Admin dashboard for event management
- Drag & drop photo uploads with resume capability
- EXIF metadata extraction
- Multiple download formats (original, Instagram-ready)
- Batch downloads
- Mobile app for direct photo uploads from phones

See [subdomains/photos/README.md](./subdomains/photos/README.md) for detailed documentation and setup instructions.

## Development

Each subdomain has its own development setup. Refer to the subdomain's README for specific instructions.

## Deployment

Each subdomain is deployed independently:
- **Photos**: Cloudflare Pages (frontend) + Cloudflare Workers (backend)

## License

Proprietary - Thijs van Tol
