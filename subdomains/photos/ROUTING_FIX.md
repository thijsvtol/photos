# Routing Fix: photos.thijsvtol.nl Root Path 404 Error

## Problem

The URL `https://photos.thijsvtol.nl/` was returning:
```json
{"error":"Not found"}
```

This error message was coming from the Worker's 404 handler in `apps/worker/src/index.ts`, indicating that the Worker was incorrectly handling the root path.

## Root Cause

The `apps/web/public/_routes.json` file was configured with:
```json
{
  "version": 1,
  "include": [
    "/api/*",
    "/media/*"
  ]
}
```

This configuration tells Cloudflare Pages: "Invoke Pages Functions for `/api/*` and `/media/*` routes."

However, this project does NOT use Pages Functions (there's no `/functions` directory). Instead, it uses:
- **Cloudflare Pages**: To serve the React SPA static assets
- **Standalone Worker**: Deployed separately via wrangler with zone-level routes

The mismatch caused routing confusion where Pages was trying to invoke non-existent Functions, potentially causing all routes (including `/`) to be mishandled.

## Solution

Changed `_routes.json` to:
```json
{
  "version": 1,
  "exclude": [
    "/*"
  ]
}
```

This explicitly tells Cloudflare Pages: "Serve ONLY static assets, NEVER invoke Pages Functions for any route."

## How the Architecture Works Now

### Cloudflare Pages (Frontend)
- Serves static assets from `apps/web/dist/`
- Handles the root path `/` by serving `index.html`
- React Router handles client-side routing
- The `_routes.json` with `exclude: ["/*"]` ensures no Pages Functions are invoked

### Standalone Worker (Backend)
- Deployed via `wrangler deploy` with production routes:
  ```toml
  routes = [
    { pattern = "photos.thijsvtol.nl/api/*", zone_name = "thijsvtol.nl" },
    { pattern = "photos.thijsvtol.nl/media/*", zone_name = "thijsvtol.nl" }
  ]
  ```
- Handles `/api/*` and `/media/*` routes at the Cloudflare zone level
- Independent from Pages deployment

### Request Flow
1. User visits `https://photos.thijsvtol.nl/` → Cloudflare Pages serves `index.html`
2. User visits `https://photos.thijsvtol.nl/api/events` → Cloudflare zone routing directs to Worker
3. User visits `https://photos.thijsvtol.nl/media/photo.jpg` → Cloudflare zone routing directs to Worker
4. User visits `https://photos.thijsvtol.nl/events/wedding` → Cloudflare Pages serves `index.html`, React Router handles client routing

## Key Differences: Pages Functions vs. Standalone Worker

### Pages Functions (NOT used in this project)
- Functions live in `/functions` directory within the Pages project
- `_routes.json` with `include` tells Pages which routes to invoke Functions for
- Functions are deployed as part of the Pages deployment
- Functions have access to Pages environment

### Standalone Worker (USED in this project)
- Worker is a separate project deployed via wrangler
- Worker routes configured in `wrangler.toml` at zone level
- Deployed independently from Pages
- `_routes.json` should exclude all routes to prevent Pages from trying to invoke non-existent Functions

## Deployment Checklist

1. ✅ Deploy Worker: `cd apps/worker && npm run deploy`
2. ✅ Build Web: `cd apps/web && npm run build`
3. ✅ Deploy Pages: Deploy `apps/web/dist/` to Cloudflare Pages
4. ✅ Configure custom domain: Add `photos.thijsvtol.nl` to Pages project
5. ✅ Verify `_routes.json` is in build output with `exclude: ["/*"]`
6. ✅ Test root path: `https://photos.thijsvtol.nl/` should serve the React app
7. ✅ Test API: `https://photos.thijsvtol.nl/api/events` should return JSON from Worker

## Files Modified

1. `apps/web/public/_routes.json` - Changed from `include` to `exclude: ["/*"]`
2. `DEPLOYMENT.md` - Updated documentation to explain the routing configuration
3. `README.md` - Clarified the routing behavior and architecture

## References

- [Cloudflare Pages Routing Documentation](https://developers.cloudflare.com/pages/functions/routing/)
- [Cloudflare Worker Routes Documentation](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Cloudflare Pages + Workers Architecture](https://developers.cloudflare.com/pages/functions/advanced-mode/)
