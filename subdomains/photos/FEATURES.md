# Features Documentation

Comprehensive guide to all features in the photo sharing application.

## Core Features

### 📸 Event Management

Organize photos into discrete events with rich metadata.

**Key Capabilities:**
- Create unlimited events with custom slugs
- Set event date, location, and description
- GPS coordinates with automatic reverse geocoding
- Public or private visibility control
- Optional password protection
- Tag events for easy discovery

**Admin Dashboard:**
- Create/edit/delete events
- Bulk photo upload
- Event analytics
- Collaborator management

**Use Cases:**
- Wedding photo galleries
- Birthday party albums
- Vacation photo collections
- Corporate event documentation
- Family reunion galleries

---

### 🖼️ Photo Upload & Management

Advanced photo upload system with automatic processing.

**Upload Features:**
- Drag-and-drop interface
- Multi-file selection
- Upload queue with progress tracking
- Retry failed uploads
- Client-side image preview generation
- EXIF data extraction
- GPS location extraction
- Blurhash generation for placeholders

**Image Processing:**
- **Original**: Full resolution preserved
- **Preview**: Max 1200px for web viewing
- **Instagram**: 1080x1080 square crop
- Automatic format optimization
- Progressive JPEG encoding

**Supported Formats:**
- JPEG (.jpg, .jpeg)
- PNG (.png)
- HEIC (.heic) - iOS photos
- WebP (.webp)
- Videos (.mp4, .mov) - stored but not transcoded

**Metadata Preserved:**
- Camera make/model
- ISO, aperture, shutter speed
- Focal length
- Capture timestamp
- GPS coordinates
- Image dimensions

---

### 🗺️ Location & Geocoding

Automatic location detection from GPS data.

**Features:**
- Extract GPS coordinates from EXIF
- Reverse geocoding to readable addresses
- Display location on maps
- Filter photos by location
- Privacy: optional GPS data removal

**Location Hierarchy:**
- Country
- State/Province
- City
- Custom location name

**Data Source:**
- OpenStreetMap Nominatim API
- No API key required
- Respects rate limits
- Fallback to manual entry

**Manual Override:**
- Edit location after upload
- Add location to photos without GPS
- Batch location updates

---

### 🔐 Authentication & Authorization

Multi-layer security with OAuth and role-based access.

**Authentication Methods:**
- Cloudflare Access (OAuth)
- Supported providers: Google, GitHub, Microsoft, etc.
- JWT token for API access
- Session persistence

**Permission Levels:**

**Admin:**
- Full access to all features
- Create/edit/delete events
- Manage collaborators
- Access analytics
- Configure settings

**Collaborator:**
- Upload to assigned events
- View collaborator-only events
- Receive notifications

**Authenticated User:**
- View public events
- Add favorites
- Access password-protected events with password

**Public (Unauthenticated):**
- View public events only
- No favorites or uploads
- Password-protected access with password

**Email-Based Admin:**
- Admin status determined by `ADMIN_EMAILS` env var
- Comma-separated email list
- No database management needed

---

### 🤝 Collaboration System

**Status:** Optional (requires Mailgun)

Invite others to upload photos to your events.

**Invitation Methods:**

**1. Email Invitation**
- Send invitation to specific email
- Personalized email with event details
- One-click acceptance
- Automatic collaborator status

**2. Shareable Invite Links**
- Generate public invite URL
- Set expiration date (1-30 days)
- Limit number of uses
- Single-use or multi-use
- Revoke anytime

**Collaborator Features:**
- Upload photos to event
- View event details
- Receive upload notifications
- See other collaborators

**Notification System:**
- Email when invited
- Email when someone uploads (if collaborator)
- Configurable per-event

**History Tracking:**
- Audit log of collaborator actions
- Track invitation/acceptance dates
- Monitor upload activity

**Use Cases:**
- Wedding photographers + family contributions
- Event attendees sharing photos
- Team photo collections
- Multi-photographer projects

---

### ⭐ Favorites System

Save favorite photos for quick access.

**Features:**
- One-click favorite/unfavorite
- Personal favorites (not visible to others)
- Filter by favorites in gallery
- Dedicated favorites page
- Cross-event favorites

**Analytics:**
- Most favorited photos (admin)
- Per-user favorite counts
- Trending photos

**Implementation:**
- Real-time updates
- Optimistic UI updates
- Per-user storage

---

### 🖼️ Gallery Views

Flexible photo viewing with advanced controls.

**Grid View:**
- Responsive masonry layout
- Infinite scroll
- Lazy loading
- Blurhash placeholders
- Hover previews

**Lightbox View:**
- Full-screen photo viewing
- Keyboard navigation (← →)
- Swipe gestures (mobile)
- Zoom capability
- EXIF data overlay
- Location information
- Download original

**Sorting Options:**
- Date taken (newest/oldest)
- Upload date
- Filename
- Location
- Favorites first

**Filtering:**
- By date range
- By location
- By uploader
- Favorites only

**Sharing:**
- Share individual photo URLs
- Share event URLs
- Copy image URLs
- Download originals

---

### 📊 Analytics Dashboard

**Status:** Admin only

Comprehensive insights into usage and engagement.

**Overall Statistics:**
- Total events
- Total photos
- Total users
- Total favorites
- Total collaborations

**Per-Event Analytics:**
- Photo count
- Collaborator count
- Favorite count
- Upload timeline
- Location distribution

**Per-User Analytics:**
- Upload count
- Favorite count
- Collaboration count
- Activity timeline

**Popular Photos:**
- Most favorited
- Most viewed (if tracking added)
- Recent activity

**Export Capabilities:**
- CSV export (future)
- API access to stats
- Dashboard widgets (future)

---

### 🏷️ Tagging System

Categorize and discover events with tags.

**Tag Features:**
- Admin-created tags
- Assign multiple tags per event
- Filter events by tag
- Tag usage analytics
- Tag suggestions

**Common Tags:**
- `wedding`, `birthday`, `vacation`
- `music`, `sports`, `outdoor`
- `family`, `friends`, `corporate`
- `2024`, `summer`, `europe`

**Management:**
- Create/delete tags
- Bulk tag assignment
- Tag renaming
- Merge duplicate tags

---

### 🔒 Privacy & Security

**Event Visibility:**

**Public Events:**
- Listed on homepage
- Visible to anyone with link
- Indexed by search engines (sitemap)

**Private Events:**
- Not listed publicly
- Only admins and collaborators see
- Require direct link

**Password Protected:**
- Additional password layer
- Session-based access
- Per-event passwords
- Optional expiration

**Data Security:**
- HTTPS only
- JWT token authentication
- SQL injection prevention
- XSS protection
- CORS restrictions
- Cloudflare DDoS protection

**Privacy Controls:**
- Remove GPS data option
- Hide photos from public
- Delete photos permanently
- Revoke collaborator access

---

### 📱 Mobile Experience

**Progressive Web App:**
- Responsive design
- Touch-optimized UI
- Swipe gestures
- Offline viewing (future)

**Native Android App:**
- Built with Capacitor
- Native camera integration
- Background uploads
- Push notifications (future)
- App icon and splash screen

**Mobile Features:**
- Camera upload
- Photo library access
- GPS auto-detection
- Portrait/landscape optimization
- Mobile-friendly gallery

**Browser Support:**
- Chrome/Safari/Edge (latest)
- iOS Safari 12+
- Android Chrome 80+

---

### 🎨 Customization & Branding

White-label the application with your brand.

**Configurable Elements:**
- App name
- Brand name
- Logo (upload your own)
- Color scheme (Tailwind config)
- Domain name
- Contact email
- Copyright holder

**Configuration:**
- Environment variables
- No code changes required
- Runtime configuration
- Per-deployment customization

**Example Brands:**
- "Smith Family Photos"
- "Acme Event Gallery"
- "Wedding Memories"
- "Travel Photo Archive"

---

### 🚀 Performance

**Frontend Optimization:**
- Code splitting
- Lazy loading
- Image optimization
- Blurhash placeholders
- Client-side caching
- Vite build optimization

**Backend Optimization:**
- Edge computing (Cloudflare Workers)
- Global CDN
- Database indexing
- Prepared statements
- Efficient queries

**Load Times:**
- Initial page: <2s
- Gallery load: <1s
- Photo view: <500ms
- Upload start: <100ms

**Scalability:**
- Handles millions of requests
- Auto-scales with traffic
- No server management
- Pay-per-use pricing

---

### 🔧 Developer Experience

**Local Development:**
- Hot module replacement (Vite)
- Local database (Wrangler)
- TypeScript type safety
- ESLint + Prettier
- Vitest unit tests
- Playwright e2e tests

**Developer Tools:**
- Extensive logging
- Error tracking ready
- API documentation
- Type definitions
- Migration system

**Extensibility:**
- Modular architecture
- Feature flags
- Plugin system (future)
- API-first design
- Open source ready

---

## Feature Configuration

### Feature Flags

Control optional features with environment variables.

| Feature | Flag | Requirement |
|---------|------|-------------|
| Email Sending | `canSendEmails` | Mailgun API key |
| Collaborators | `enableCollaborators` | Mailgun API key |
| Favorites | `enableFavorites` | Always enabled |
| Geocoding | `enableGeocoding` | Always enabled |

**Automatic Detection:**
- Features auto-enable when dependencies present
- Graceful degradation when unavailable
- Clear error messages

**Testing Features:**
```bash
# Enable all features
MAILGUN_API_KEY=your_key
MAILGUN_DOMAIN=your_domain

# Disable optional features
# Simply don't set Mailgun vars
```

---

## Feature Roadmap

### Short Term (v1.1)
- [ ] Video transcoding with Cloudflare Stream
- [ ] Bulk download (zip)
- [ ] Advanced search
- [ ] Photo editing (crop, rotate)
- [ ] QR code event sharing

### Medium Term (v1.2)
- [ ] Real-time collaboration (Durable Objects)
- [ ] Activity feed
- [ ] Comments on photos
- [ ] Albums within events
- [ ] Guest book

### Long Term (v2.0)
- [ ] AI auto-tagging (Workers AI)
- [ ] Face detection
- [ ] Duplicate detection
- [ ] Photo contests/voting
- [ ] Monetization (paid events)

### Community Requested
- Submit feature requests via GitHub Issues
- Vote on existing requests
- Contribute via pull requests

---

## Feature Comparison

### vs. Google Photos
✅ Self-hosted, privacy-first  
✅ Event-based organization  
✅ Collaboration system  
✅ White-label branding  
❌ No AI features (yet)  
❌ No face recognition  

### vs. Flickr
✅ Modern UI/UX  
✅ Faster performance  
✅ No ads  
✅ Unlimited storage (R2-based)  
❌ No public social features  
❌ No groups/communities  

### vs. SmugMug
✅ Free and open source  
✅ Easier setup  
✅ API-first architecture  
❌ No pro photography features  
❌ No client proofing  

---

## Usage Examples

### Wedding Photography
1. Create event: "Smith Wedding 2024"
2. Set password for family access
3. Invite photographer as collaborator
4. Share invite link with guests
5. Collect photos from all attendees
6. Share gallery with password

### Family Vacation
1. Create event: "Hawaii 2024"
2. Add GPS coordinates
3. Upload photos daily
4. Tag favorite moments
5. Share public link with relatives
6. Download all originals

### Corporate Event
1. Create private event
2. Invite team as collaborators
3. Multiple uploaders during event
4. Analytics on engagement
5. Export high-res photos
6. Archive after 30 days

### Photography Portfolio
1. Create public events per shoot
2. Showcase best work
3. Client galleries with passwords
4. Track photo favorites
5. SEO-optimized galleries
6. White-label with your brand

---

## Accessibility Features

**Keyboard Navigation:**
- Tab through interface
- Arrow keys in gallery
- Escape to close modals
- Enter to confirm actions

**Screen Reader Support:**
- ARIA labels
- Alt text on images
- Semantic HTML
- Focus management

**Visual Accessibility:**
- High contrast mode support
- Configurable font sizes
- Color-blind friendly
- Clear focus indicators

**Future Improvements:**
- Voice commands
- Auto-captions for photos
- High contrast theme
- Dyslexia-friendly font

---

## Feature Support Matrix

| Feature | Web | Mobile | Admin |
|---------|-----|--------|-------|
| View photos | ✅ | ✅ | ✅ |
| Upload photos | ❌ | ✅ | ✅ |
| Favorites | ✅ | ✅ | ✅ |
| Collaborators | ❌ | ✅ | ✅ |
| Analytics | ❌ | ❌ | ✅ |
| Event management | ❌ | ❌ | ✅ |
| Tags | ✅ | ✅ | ✅ |
| Location | ✅ | ✅ | ✅ |

---

## User Feedback

We continuously improve based on user feedback. Common requests:

**Most Requested:**
1. Video support with transcoding ⏳
2. Bulk photo download ⏳
3. Comments on photos 🔜
4. Face detection 📅
5. Mobile iOS app 📅

**Recent Additions:**
- ✅ Invite links (v1.0)
- ✅ Video storage (v1.0)
- ✅ Analytics dashboard (v0.9)
- ✅ Collaborator system (v0.8)

**Share Your Ideas:**
- GitHub Issues
- Email: [See CONFIGURATION.md for contact]
- Discussions forum

---

## Performance Benchmarks

**Upload Performance:**
- 10MB photo: ~5-8 seconds
- Preview generation: ~1 second
- Metadata extraction: <100ms
- Concurrent uploads: 3 parallel

**Gallery Performance:**
- 1000 photos load: <2 seconds
- Infinite scroll: 50 photos/batch
- Lightbox open: <100ms
- Filter/sort: <500ms

**Database Performance:**
- Event list query: <50ms
- Photo list query: <100ms
- Analytics query: <200ms
- Favorites toggle: <50ms

**Optimization Tips:**
- Enable Cloudflare caching
- Use preview images for thumbnails
- Lazy load below-fold images
- Preload next photo in lightbox

---

## Limitations & Known Issues

**Current Limitations:**
- No video transcoding (stored as-is)
- Max 5GB per R2 upload (multipart)
- D1 database: 1GB max size
- No built-in image editing
- No mobile iOS app (web only)

**Known Issues:**
- HEIC upload on some Android browsers
- Safari blurhash rendering quirks
- Slow geocoding for some locations

**Workarounds:**
- Convert HEIC to JPEG before upload
- Use Chrome for best compatibility
- Manually set location if geocoding fails

See GitHub Issues for full bug list and status.

---

## FAQ

**Q: How many photos can I store?**  
A: R2 storage is unlimited. D1 database can hold ~1M photos before hitting 1GB limit.

**Q: Can I customize the look and feel?**  
A: Yes! Edit Tailwind config, upload custom logo, set brand name in env vars.

**Q: Is this truly open source?**  
A: Yes, fully open source. Check LICENSE file for details.

**Q: Can I run this without Cloudflare?**  
A: Not easily. It's designed for Cloudflare Workers + D1 + R2.

**Q: How much does it cost to run?**  
A: Cloudflare free tier covers ~100K photos/month. Paid plans start at $5/month.

**Q: Can I migrate from Google Photos?**  
A: Not yet. Migration tool is planned for future release.

**Q: Is there a hosted version?**  
A: Not officially. This is self-hosted software.

**Q: How do I contribute?**  
A: See CONTRIBUTING.md for guidelines!

---

For more information:
- [Configuration Guide](CONFIGURATION.md)
- [API Documentation](API.md)
- [Architecture Overview](ARCHITECTURE.md)
- [Contributing Guide](CONTRIBUTING.md)
