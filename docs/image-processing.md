# Image Processing Note

## Current Implementation Status

**As of this writing, this is the current, shipped architecture** - not a temporary pre-launch gap.
Preview generation happens entirely client-side; there is **no server-side watermarking, resizing,
or Instagram-style derivative** anywhere in the codebase (confirmed: `generateWatermarkText()` in
`apps/worker/src/imageProcessing.ts` exists but is not called from any route).

### What Actually Happens Today

1. **Original**: The uploaded file (photo, video, or RAW) is stored as-is in R2 under `original/{eventSlug}/{photoId}.{ext}`, with no server-side modification.
2. **Preview**: The browser (`apps/web/src/imageUtils.ts#createPreview`, or the RAW-decode path in `rawImageUtils.ts`) resizes the image client-side to a max of 1920px on the longest side at 85% JPEG quality, and uploads that as a second file to `preview/{eventSlug}/{photoId}.jpg`. Videos don't get a separate preview file - the original is served for both `preview` and `original` requests.
3. **No watermark** is applied to either derivative.
4. **No Instagram-square (`ig/`) derivative** is generated for new uploads. The `ig/` R2 key prefix and its `media.ts` route still exist only so that (a) old links/cached objects from earlier versions keep working, and (b) photo deletion cleans up any leftover `ig/` object. No code path writes new files there.

### Historical Context (superseded)

Earlier drafts of this document proposed adding server-side watermarking and Instagram-derivative
generation (via Cloudflare Images, a dedicated image-processing Worker + Queues, or an external
service) before a "v1 launch". That work was never built, and the client-side-only approach above
shipped instead and has remained the architecture since. The options below are kept for reference
in case watermarking/server-side derivatives are revisited in the future, but should not be read as
an imminent roadmap item.

### Implementation Options (if this is revisited)

#### Option 1: Cloudflare Images (Recommended)

Use Cloudflare Images service with transformations and watermarking.

**Pros:**

- Native Cloudflare integration
- Built-in transformations and watermarking
- CDN integration
- No custom code needed

**Cons:**

- Additional cost per image
- Requires Cloudflare Images subscription

#### Option 2: Worker with Image Processing

Use a Cloudflare Worker with image manipulation library (e.g., `@cloudflare/image-resizing` or `sharp` compiled to WASM).

**Pros:**

- Full control over processing
- No additional service costs
- Can process on upload

**Cons:**

- Workers have size and CPU limitations
- More complex implementation
- May need to use Durable Objects for async processing

#### Option 3: External Processing Service

Trigger an external service (e.g., AWS Lambda, Google Cloud Functions) after upload.

**Pros:**

- Unlimited processing power
- Can use any image library
- Separate concerns

**Cons:**

- Additional infrastructure
- Network latency
- More complex architecture

### If Revisited

Any future work here would likely follow **Option 2** with a dedicated worker for image processing:

1. Create a separate Worker (e.g. `apps/image-processor`)
2. After upload completes, queue a job to process the image
3. Use Cloudflare Queues to handle async processing
4. Generate a watermarked/Instagram derivative
5. Store results in R2

### Current Behavior (not a workaround - this is the shipped design)

- Originals are stored in R2 as uploaded
- The client-generated 1920px JPEG preview is stored in R2 alongside the original
- `GET /media/:slug/ig/:photoId` still exists for backward compatibility but no route or upload
  path ever writes a new `ig/` object
- No watermarks are applied anywhere

## Related Files (if implementing server-side processing in the future)

1. **Worker**: `apps/worker/src/imageProcessing.ts` already has `generateWatermarkText()` /
   `formatWatermarkTime()` helpers that aren't called from anywhere - a real implementation would
   need to actually invoke them from an upload-completion hook (e.g. in
   `apps/worker/src/routes/admin/uploads.ts`)
2. **New Worker**: a separate `apps/image-processor` worker (or Cloudflare Images) for the actual
   image manipulation
3. **Database**: `photos` already has `preview_complete`/`upload_complete` flags (see
   [migrations/020_photo_preview_complete.sql](../migrations/020_photo_preview_complete.sql)) that
   a server-side pipeline could reuse or extend to track additional derivative generation status
4. **Frontend**: `apps/web/src/pages/AdminEventUpload.tsx` already shows upload progress and could
   be extended to show server-side processing status
