const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const slug = 'test-event';
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

  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/favorites')) return route.fulfill({ json: { favoriteIds: [] } });
    if (url.includes('/collaborators')) return route.fulfill({ json: { collaborators: [] } });
    route.continue();
  });
  await page.route('**/api/events/*/photos/*/preview*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
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

  page.on('console', m => console.log('LOG', m.text())); page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto(`http://localhost:5173/events/${slug}`);
  await page.waitForTimeout(1500);

  await page.evaluate(() => window.scrollTo(0, 4000));
  await page.waitForTimeout(500);
  console.log('scrollBefore', await page.evaluate(() => window.scrollY));

  const clicked = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-photo-id]'));
    const target = cards.find(c => {
      const r = c.getBoundingClientRect();
      return r.top > 0 && r.top < window.innerHeight;
    });
    if (target) { target.querySelector('a').click(); return target.getAttribute('data-photo-id'); }
    return null;
  });
  console.log('clicked', clicked);
  await page.waitForTimeout(800);
  console.log('sessionStorage after click:', await page.evaluate((slug) => ({
    scroll: sessionStorage.getItem(`gallery_scroll_${slug}`),
    photo: sessionStorage.getItem(`gallery_photo_${slug}`)
  }), slug));
  console.log('url', page.url());

  const backBtn = await page.$('button[aria-label="Back"]');
  console.log('backBtn found', !!backBtn);
  if (backBtn) await backBtn.click();

  // poll for a couple seconds, checking scrollY and DOM element presence
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(200);
    const info = await page.evaluate((clickedId) => ({
      url: location.pathname,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      elExists: !!document.querySelector(`[data-photo-id="${clickedId}"]`),
      photoCount: document.querySelectorAll('[data-photo-id]').length,
    }), clicked);
    console.log(i, JSON.stringify(info));
  }

  await browser.close();
})();
