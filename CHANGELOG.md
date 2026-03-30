# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.4] - 2026-03-30

### Changed
- Android app release bumped to build 15 (versionName 1.4.4).
- Project package versions synchronized to 1.4.4.

### Fixed
- Admin dashboard storage estimate now counts only unique stored originals and excludes DB-only copied photo references.
- Production media loading regression resolved by applying migration 016 so source photo columns exist for media lookup queries.

## [1.4.2] - 2026-03-29

### Changed
- Android app release bumped to build 13 (versionName 1.4.2).
- Project package versions synchronized to 1.4.2.

### Fixed
- Worker TypeScript strict typing issues in collaborator routes for optional path params and invite-link payload parsing.
- Invite flow in gallery share menu now opens an in-app collaborator invite modal instead of opening social/native share.
- Invite option visibility and role detection in gallery improved to correctly recognize event collaborator/admin permissions across API email field variations.

### Security
- Patched brace-expansion moderate-severity vulnerability in web dependencies via targeted npm overrides:
- brace-expansion@^1.1.7 -> 1.1.13
- brace-expansion@^5.0.2 -> 5.0.5

## [1.4.1] - 2026-03-29

### Added
- Event collaborator role model and capability-based access controls across backend and frontend.
- Roles: viewer, uploader, editor, admin.
- Capability checks for upload, image edit, photo delete, bulk delete, invite create/revoke, collaborator removal, role changes, and featured photo management.
- Collaborator role update endpoint for event admins.

### Changed
- Collaborator and invite API flows now use event capability checks instead of blanket admin-only client behavior.
- Admin photo routes switched to per-event capability checks instead of global admin middleware.
- Last-admin safeguards added for collaborator removal and demotion flows.

### Fixed
- Web build blockers fixed for Android release pipeline:
- ImageEditorModal pixel ratio and required props typing.
- ShareEventButton clipboard fallback handling.
- CollaboratorManager tests updated for role-based collaborator and invite types.
- React hook dependency and lint issues resolved in gallery and photo detail pages.
- Android local build prerequisites and signing flow validated for release artifact generation.

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

