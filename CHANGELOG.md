# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-02-18

### Added
- Initial public release
- Complete photo sharing application with event management
- Admin dashboard with analytics
- Photo upload with EXIF extraction
- GPS metadata and map view for photos
- Batch photo operations (delete, download as ZIP)
- Favorites system for users
- Event collaboration features
- Invite links for event access
- Tag-based event organization
- Mobile app (Capacitor-based Android/iOS)
- Contact form functionality
- Photo watermarking
- Progressive image loading

### Infrastructure
- Cloudflare Workers backend (Hono framework)
- D1 SQLite database
- R2 object storage
- OAuth authentication support
- Comprehensive test suite (115+ tests)
- GitHub Actions CI/CD
- Development environment setup guide

## Types of Changes

When creating a new release, categorize your changes as follows:

- **Added** - New features
- **Changed** - Changes in existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security vulnerability fixes

## Release Process

1. Update this file with changes
2. Update version numbers in `package.json` files
3. Create a git tag: `git tag -a v1.0.0 -m "Version 1.0.0"`
4. Push tag: `git push origin v1.0.0`
5. Create a GitHub Release with release notes

## Versioning Scheme

We use [Semantic Versioning](https://semver.org/):
- **MAJOR** - Incompatible API changes
- **MINOR** - New functionality in backward-compatible manner
- **PATCH** - Backward-compatible bug fixes

Example: `v1.2.3` where:
- `1` = Major version
- `2` = Minor version
- `3` = Patch version
