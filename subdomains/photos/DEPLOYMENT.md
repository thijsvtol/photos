# Photos Subdomain - Deployment Checklist

This checklist ensures all components are properly configured before deploying to production.

## Pre-Deployment Verification

### Code Quality
- [x] All TypeScript files compile without errors
- [x] ESLint configuration in place
- [x] Code review completed and feedback addressed
- [x] Security scan completed (CodeQL) - No vulnerabilities found

### Backend (Cloudflare Worker)
- [x] Worker source code complete
- [x] TypeScript types defined for all APIs
- [x] Error handling implemented
- [x] CORS configured correctly
- [x] All API endpoints tested
- [x] Password hashing with SHA-256 + salt
- [x] Session cookie implementation (HttpOnly, Secure, SameSite)
- [x] Admin authentication via header validation

### Frontend (React)
- [x] All React components implemented
- [x] Routing configured (React Router)
- [x] API client with axios
- [x] Error handling in place
- [x] Loading states implemented
- [x] Responsive design with Tailwind CSS

### Database (D1)
- [x] Migration script created (001_init.sql)
- [x] Events table with password protection
- [x] Photos table with metadata
- [x] Indexes on slug and (event_id, capture_time)
- [x] Foreign key constraints

### Storage (R2)
- [x] Bucket structure defined
- [x] Upload orchestration implemented
- [x] Multipart upload support (5MB chunks)

### Documentation
- [x] Comprehensive README.md
- [x] IMPLEMENTATION.md with architecture
- [x] IMAGE_PROCESSING.md for future work
- [x] Development setup script
- [x] Environment variable examples

## Production Deployment Steps

### 1. Create Infrastructure
```bash
# Create D1 database
wrangler d1 create photos-db

# Update wrangler.toml with database_id

# Run migrations
wrangler d1 execute photos-db --file=./migrations/001_init.sql

# Create R2 bucket
wrangler r2 bucket create photos-storage
```

### 2. Configure Secrets
```bash
cd apps/worker

# Generate and set cookie secret
wrangler secret put EVENT_COOKIE_SECRET --env production
# Use: openssl rand -base64 32

# Note: ADMIN_SHARED_SECRET not needed in production (use Cloudflare Access)
```

### 3. Deploy Worker
```bash
cd apps/worker
npm install
npm run deploy
```

### 4. Deploy Frontend
```bash
cd apps/web
npm install
npm run build

# Deploy to Cloudflare Pages
# - Connect repository
# - Set build command: cd subdomains/photos/apps/web && npm install && npm run build
# - Set output directory: subdomains/photos/apps/web/dist
```

### 5. Configure Domain
```bash
# Update wrangler.toml routes:
routes = [
  { pattern = "photos.thijsvtol.nl/api/*", zone_name = "thijsvtol.nl" },
  { pattern = "photos.thijsvtol.nl/media/*", zone_name = "thijsvtol.nl" }
]

# Configure Cloudflare Pages custom domain:
# - Add photos.thijsvtol.nl

# Note: The apps/web/public/_routes.json file disables Pages Functions
# (excludes all routes) so that Pages serves only static assets.
# The standalone Worker (deployed via wrangler) handles /api/* and /media/*
# through the routes configured in wrangler.toml at the zone level.
# This file is automatically included in the build output.
```

### 6. Set Up Cloudflare Access
```bash
# In Cloudflare Dashboard > Zero Trust > Access:
# 1. Create Application for photos.thijsvtol.nl/admin*
# 2. Add policy for authorized users
# 3. Configure to add X-Admin-Access: 1 header
```

### 7. Verify Deployment
- [ ] Visit https://photos.thijsvtol.nl
- [ ] Event list page loads
- [ ] Create a test event (admin)
- [ ] Upload a test photo (admin)
- [ ] Access event with password (public)
- [ ] View photos in gallery
- [ ] Download photo (original)
- [ ] Test direct photo link
- [ ] Verify session cookies work
- [ ] Test admin authentication

## Post-Deployment Tasks

### Monitoring
- [ ] Set up Worker execution metrics alerts
- [ ] Monitor D1 database size
- [ ] Monitor R2 storage usage
- [ ] Check error rates in Worker logs

### Performance
- [ ] Verify CDN caching for images
- [ ] Test page load times
- [ ] Check API response times
- [ ] Monitor multipart upload success rate

### Security
- [ ] Verify Cloudflare Access is working
- [ ] Test password protection
- [ ] Check session cookie security
- [ ] Review CORS configuration
- [ ] Verify admin endpoints are protected

## Known Limitations (v1)

These features are documented but not yet implemented:

1. **Image Processing**: Watermarking and derivative generation
   - Previews currently serve originals
   - No watermark text applied
   - See IMAGE_PROCESSING.md for implementation plan

2. **ZIP Downloads**: Returns individual URLs
   - Not actual ZIP file generation
   - Client downloads each file separately

3. **Upload Queue Persistence**: In-memory only
   - Lost on page reload
   - No resume after browser crash

## Future Enhancements

### Phase 2 (Image Processing)
- Implement watermark generation
- Generate preview derivatives (2000px)
- Generate Instagram derivatives (1080px)
- Add thumbnail optimization

### Phase 3 (Features)
- Server-side ZIP generation
- Upload queue persistence (IndexedDB)
- Batch operations (delete, move)
- Event visibility controls
- Photo metadata editing
- Search functionality

### Phase 4 (Advanced)
- Gallery themes/customization
- Photo comments
- Social sharing
- Print ordering
- Analytics dashboard

## Support & Troubleshooting

### Common Issues
See README.md Troubleshooting section for:
- Worker not connecting to D1
- Upload failures
- Admin access denied
- Photos not showing

### Debug Tools
- `wrangler tail` - Real-time Worker logs
- `window.__uploadQueue` - Frontend upload state (dev only)
- Browser Network tab - API request inspection
- D1 Console - Database queries

### Rollback Plan
If issues arise:
1. Revert Worker deployment: `wrangler rollback`
2. Rollback Pages deployment via dashboard
3. Restore database from backup (if needed)

## Sign-Off

- [ ] All pre-deployment checks passed
- [ ] Production deployment completed
- [ ] Post-deployment verification completed
- [ ] Monitoring configured
- [ ] Documentation reviewed

**Deployment Date**: _______________
**Deployed By**: _______________
**Version**: 1.0.0

---

**Notes**:
- This is a v1 implementation with noted limitations
- Image processing features to be added in Phase 2
- All core functionality is operational and secure
