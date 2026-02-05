# Photos Subdomain - Deployment Checklist


## Production Deployment Steps

### 1. Create Infrastructure
```bash
# Create D1 database
wrangler d1 create photos-db

# Update wrangler.toml with database_id in both [[d1_databases]] and [[env.production.d1_databases]]

# Run all migrations on production database
cd subdomains/photos
wrangler d1 migrations apply photos-db --remote

# Create R2 bucket
wrangler r2 bucket create photos-storage
```

### 2. Configure Secrets
```bash
# Generate and set cookie secret
wrangler secret put EVENT_COOKIE_SECRET
# Enter a strong random string (use: openssl rand -base64 32)

# Note: ADMIN_SHARED_SECRET not needed in production (use Cloudflare Access)
```

### 3. Deploy Worker
```bash
cd subdomains/photos/apps/worker
npm install
cd ../..
npx wrangler deploy --env production
```

### 4. Deploy Frontend to Cloudflare Pages

**Create Pages Project:**
1. Go to Cloudflare Dashboard → **Workers & Pages**
2. Click **Create** → Select **Pages** tab (not Workers)
3. Connect to your Git repository
4. Select the repository and configure:
   - **Project name**: `photos`
   - **Production branch**: `main`
   - **Framework preset**: Vite (or None)
   - **Root directory**: `subdomains/photos/apps/web`
   - **Build command**: `npm install && npm run build`
   - **Build output directory**: `dist`
   - **Deploy command**: `echo "Deploy complete"`
5. Click **Save and Deploy**

**Note**: No environment variables needed for the frontend.

### 5. Configure Domain

**1. Worker Routes (in wrangler.toml):**
```toml
[env.production]
name = "photos-worker"
routes = [
  { pattern = "photos.thijsvtol.nl/api/*", zone_name = "thijsvtol.nl" },
  { pattern = "photos.thijsvtol.nl/media/*", zone_name = "thijsvtol.nl" }
]
```

**2. Add Custom Domain to Pages:**
- In Pages project → **Custom domains**
- Click **Set up a custom domain**
- Enter `photos.thijsvtol.nl`
- Wait for DNS propagation (usually 1-2 minutes)

**3. Routing Configuration:**
The `apps/web/public/_routes.json` file is automatically included in the build:
```json
{
  "version": 1,
  "include": ["/*"],
  "exclude": ["/api/*", "/media/*"]
}
```

This configuration ensures:
- Pages serves the React app for all routes
- Worker handles `/api/*` and `/media/*` via routes configured in wrangler.toml
- No conflicts between Pages and Worker routing

### 6. Set Up Cloudflare Access (Optional - for Admin Protection)

**Enable Zero Trust (if not already enabled):**
1. Go to **Cloudflare Dashboard** → **Zero Trust**
2. If prompted, complete the Zero Trust setup

**Create Access Application:**
1. Go to **Zero Trust** → **Access** → **Applications**
2. Click **Add an application**
3. Select **Self-hosted**
4. Configure application:
   - **Application name**: `Photos Admin`
   - **Session duration**: `24 hours` (or your preference)
   - **Application domain**:
     - Subdomain: `photos`
     - Domain: `thijsvtol.nl`
     - Path: `/admin*` (protects all admin routes)
5. Click **Next**

**Create Access Policy:**
1. **Policy name**: `Admin Users`
2. **Action**: `Allow`
3. **Configure rules** - Choose one or more:
   - **Emails**: Add your email address(es)
   - **Emails ending in**: Your domain (e.g., `@yourdomain.com`)
   - **Everyone**: If you want to allow anyone (not recommended)
4. Click **Next**

**Configure Additional Settings:**
1. **CORS settings**: Leave default
2. **Cookie settings**: Leave default
3. **Identity** (optional): Configure login methods (Google, GitHub, etc.)
4. Click **Add application**

**How Cloudflare Access Works (Free Plan):**

Cloudflare Access automatically adds a `Cf-Access-Jwt-Assertion` header to authenticated requests, even on the free plan. The Worker checks for this header to verify admin access.

**No additional configuration needed!** Just create the Access application as described above, and the authentication will work automatically.

**Testing:**
1. Visit `https://photos.thijsvtol.nl/admin`
2. You'll be prompted to authenticate via Cloudflare Access
3. After logging in, you should see the admin dashboard
4. The Worker will automatically verify your access via the JWT header

**How It Works:**
- When users access `/admin*` routes, Cloudflare Access prompts for authentication
- After successful login, Cloudflare automatically adds a `Cf-Access-Jwt-Assertion` header
- The Worker verifies this JWT header to authorize admin API calls
- Sessions are managed by Cloudflare (no additional setup needed)
- Works on **free plan** - no custom header configuration required!

**Alternative: Use Admin Shared Secret (Development/Testing Only)**
For development or if you don't want to set up Cloudflare Access:
```bash
wrangler secret put ADMIN_SHARED_SECRET
# Set a strong password

# Then add this header to your admin API requests:
# X-Admin-Secret: your-admin-secret
```
⚠️ **Warning**: This is less secure than Cloudflare Access and should only be used for development.


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
