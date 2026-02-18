# Image Processing Note

## Current Implementation Status

The current implementation includes the infrastructure for serving watermarked images and derivatives, but **image processing is not yet implemented**. Here's what needs to be added:

### Missing Components

1. **Watermark Generation**
   - After upload, generate watermarked versions of images
   - Watermark text: `<Brand Name> • <YYYY-MM-DD HH:MM> • <Event name>`
   - Position: Bottom-right corner
   - Time: Europe/Amsterdam timezone

2. **Preview Derivative** (max 2000px long edge)
   - Resize original to max 2000px on longest side
   - Apply watermark
   - Store in `preview/{eventSlug}/{photoId}.jpg`

3. **Instagram Derivative** (max 1080px long edge)
   - Resize original to max 1080px on longest side
   - Apply watermark
   - Store in `ig/{eventSlug}/{photoId}.jpg`

### Implementation Options

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

### Recommended Approach

For v1, we recommend **Option 2** with a dedicated worker for image processing:

1. Create a separate Worker (`apps/image-processor`)
2. After upload completes, queue a job to process the image
3. Use Cloudflare Queues to handle async processing
4. Generate both derivatives and apply watermarks
5. Store results in R2

### Temporary Workaround

Until image processing is implemented, the system will:
- Store originals in R2
- Return originals when preview/IG URLs are requested
- No watermarks applied

To enable full functionality, implement one of the options above before production launch.

## Related Files to Update

When implementing image processing:

1. **Worker**: `apps/worker/src/routes/admin.ts`
   - After upload completion, trigger image processing
   
2. **New Worker**: `apps/image-processor/`
   - Create new worker for image processing
   - Add watermarking logic
   - Add resizing logic
   
3. **Database**: Add processing status to photos table
   - Track if derivatives have been generated
   - Store processing errors

4. **Frontend**: `apps/web/src/pages/AdminEventUpload.tsx`
   - Show processing status after upload
   - Display errors if processing fails
