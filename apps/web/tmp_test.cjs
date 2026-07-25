const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const slug = 'test-event';
  const now = Date.now();
  // Build 300 photos spanning a single date (simplest case) with varying dims
  const photos = [];
  for (let i = 0; i < 300; i++) {
    photos.push({
      id: `photo-${i}`,
      event_slug: slug,
      original_filename: `IMG_${i}.jpg`,
      capture_time: `2026-01-01T12:${String(i % 60).padStart(2,'0')}:00Z`,
      width: 1600,
      height: 1200,
      file_type: 'image/jpeg',
      blur_placeholder: null,
      cache_version: 1,
      is_featured: false,
    });
  }

  await page.route('**/api/events/' + slug, async route => {
    route.fulfill({ json: { event: { id: 'ev1', slug, name: 'Test Event', requires_password: false, created_at: '2026-01-01', cities: [] } } });
  });
  await page.route('**/api/events/' + slug + '/photos*', async route => {
    route.fulfill({ json: { photos } });
  });
  await page.route('**/api/events/' + slug + '/photos/*', async route => {
    const url = route.request().url();
    const id = url.split('/').pop();
    const photo = photos.find(p => p.id === id);
    route.fulfill({ json: { photo } });
  });
  await page.route('**/api/*', async route => {
    // catch-all fallback for other calls (favorites, collaborators etc.)
    const url = route.request().url();
    if (url.includes('/favorites')) {
      return route.fulfill({ json: { favoriteIds: [] } });
    }
    if (url.includes('/collaborators')) {
      return route.fulfill({ json: { collaborators: [] } });
    }
    route.continue();
  });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto(`http://localhost:5173/events/${slug}`);
  await page.waitForTimeout(1500);

  // Scroll down significantly
  await page.evaluate(() => window.scrollTo(0, 4000));
  await page.waitForTimeout(500);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  console.log('scrollBefore', scrollBefore);

  // find a photo card near current scroll position and click it
  const clicked = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-photo-id]'));
    // pick one that's within viewport
    const target = cards.find(c => {
      const r = c.getBoundingClientRect();
      return r.top > 0 && r.top < window.innerHeight;
    });
    if (target) {
      target.querySelector('a').click();
      return target.getAttribute('data-photo-id');
    }
    return null;
  });
  console.log('clicked photo id', clicked);
  await page.waitForTimeout(1000);
  console.log('url after click', page.url());

  // Click back arrow
  const backBtn = await page.$('button[aria-label="Back"]');
  if (backBtn) {
    await backBtn.click();
  } else {
    console.log('no back button found');
  }
  await page.waitForTimeout(1500);
  console.log('url after back', page.url());
  const scrollAfter = await page.evaluate(() => window.scrollY);
  console.log('scrollAfter', scrollAfter);

  await browser.close();
})();
