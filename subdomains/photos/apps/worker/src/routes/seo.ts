import { Hono } from 'hono';
import type { Env } from '../types';

export const seo = new Hono<{ Bindings: Env }>();

// Generate sitemap.xml
seo.get('/sitemap.xml', async (c) => {
  try {
    const { DB } = c.env;
    
    // Get all public events
    const events = await DB.prepare(`
      SELECT slug, name, inferred_date, created_at
      FROM events
      WHERE name NOT LIKE '[prive]%' AND name NOT LIKE '[hidden]%'
      ORDER BY created_at DESC
    `).all();
    
    // Get all public photos (limited to photos from public events)
    const photos = await DB.prepare(`
      SELECT p.id, e.slug as event_slug, p.uploaded_at
      FROM photos p
      JOIN events e ON p.event_id = e.id
      WHERE e.name NOT LIKE '[prive]%' AND e.name NOT LIKE '[hidden]%'
      ORDER BY p.uploaded_at DESC
      LIMIT 1000
    `).all();

    const baseUrl = 'https://photos.thijsvtol.nl';
    const now = new Date().toISOString().split('T')[0];

    // Build sitemap XML
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    // Homepage
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/</loc>\n`;
    sitemap += `    <lastmod>${now}</lastmod>\n`;
    sitemap += '    <changefreq>daily</changefreq>\n';
    sitemap += '    <priority>1.0</priority>\n';
    sitemap += '  </url>\n';
    
    // Events page
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/events</loc>\n`;
    sitemap += `    <lastmod>${now}</lastmod>\n`;
    sitemap += '    <changefreq>daily</changefreq>\n';
    sitemap += '    <priority>0.9</priority>\n';
    sitemap += '  </url>\n';
    
    // Map page
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/map</loc>\n`;
    sitemap += `    <lastmod>${now}</lastmod>\n`;
    sitemap += '    <changefreq>weekly</changefreq>\n';
    sitemap += '    <priority>0.7</priority>\n';
    sitemap += '  </url>\n';
    
    // Individual events
    for (const event of events.results) {
      sitemap += '  <url>\n';
      sitemap += `    <loc>${baseUrl}/events/${event.slug}</loc>\n`;
      const lastmod = (event.inferred_date || event.created_at) as string;
      sitemap += `    <lastmod>${lastmod.split('T')[0]}</lastmod>\n`;
      sitemap += '    <changefreq>weekly</changefreq>\n';
      sitemap += '    <priority>0.8</priority>\n';
      sitemap += '  </url>\n';
    }
    
    // Individual photos (sample, not all for performance)
    for (const photo of photos.results.slice(0, 500)) {
      sitemap += '  <url>\n';
      sitemap += `    <loc>${baseUrl}/p/${photo.event_slug}/${photo.id}</loc>\n`;
      sitemap += `    <lastmod>${(photo.uploaded_at as string).split('T')[0]}</lastmod>\n`;
      sitemap += '    <changefreq>monthly</changefreq>\n';
      sitemap += '    <priority>0.6</priority>\n';
      sitemap += '  </url>\n';
    }
    
    sitemap += '</urlset>';

    return c.text(sitemap, 200, {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    });
  } catch (error) {
    console.error('Error generating sitemap:', error);
    return c.text('Error generating sitemap', 500);
  }
});

// robots.txt handler (if not served statically)
seo.get('/robots.txt', (c) => {
  const robotsTxt = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/admin/

Sitemap: https://photos.thijsvtol.nl/sitemap.xml

Crawl-delay: 1`;

  return c.text(robotsTxt, 200, {
    'Content-Type': 'text/plain',
  });
});
