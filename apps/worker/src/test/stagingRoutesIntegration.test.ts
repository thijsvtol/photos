import { describe, expect, it } from 'vitest';

type StageConfig = {
  baseUrl: string;
  privateMediaUrl: string;
  collabMediaUrl: string;
  privateZipUrl: string;
  privateZipBody: string;
  adminToken: string;
  collabToken: string;
};

function fromAnyUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function getConfig(): StageConfig | null {
  const privateMediaUrl = process.env.STAGING_PRIVATE_MEDIA_URL || '';
  const collabMediaUrl = process.env.STAGING_COLLAB_MEDIA_URL || '';
  const privateZipUrl = process.env.STAGING_PRIVATE_ZIP_URL || '';
  const privateZipBody = process.env.STAGING_PRIVATE_ZIP_BODY || '';
  const adminToken = process.env.STAGING_ADMIN_BEARER_TOKEN || '';
  const collabToken = process.env.STAGING_COLLAB_BEARER_TOKEN || '';

  const baseUrl =
    process.env.STAGING_BASE_URL ||
    fromAnyUrl(privateMediaUrl) ||
    fromAnyUrl(collabMediaUrl) ||
    fromAnyUrl(privateZipUrl);

  const required = [
    baseUrl,
    privateMediaUrl,
    collabMediaUrl,
    privateZipUrl,
    privateZipBody,
    adminToken,
    collabToken,
  ];

  const missing = required.some((v) => !v);
  const placeholder = required.some(
    (v) => v.startsWith('__REPLACE_') || v.startsWith('CHANGE_ME')
  );

  if (missing || placeholder) return null;

  return {
    baseUrl,
    privateMediaUrl,
    collabMediaUrl,
    privateZipUrl,
    privateZipBody,
    adminToken,
    collabToken,
  };
}

async function req(
  method: string,
  url: string,
  opts?: { token?: string; body?: unknown; rawBody?: string; contentType?: string }
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;

  if (opts?.rawBody !== undefined) {
    headers['Content-Type'] = opts.contentType || 'application/json';
    return fetch(url, { method, headers, body: opts.rawBody });
  }

  if (opts?.body !== undefined) {
    headers['Content-Type'] = opts.contentType || 'application/json';
    return fetch(url, { method, headers, body: JSON.stringify(opts.body) });
  }

  return fetch(url, { method, headers });
}

function expectOneOf(status: number, allowed: number[], route: string) {
  expect(
    allowed.includes(status),
    `${route}: got ${status}, expected one of ${allowed.join(', ')}`
  ).toBe(true);
}

const cfg = getConfig();
const maybeIt = cfg ? it : it.skip;

describe('Staging Integration - Full Worker Routes + Auth/Session Edges', () => {
  maybeIt('covers public + SEO + feature routes', async () => {
    const checks: Array<{ method: string; path: string; body?: unknown; allowed: number[] }> = [
      { method: 'GET', path: '/health', allowed: [200, 503, 526] },
      { method: 'GET', path: '/sitemap.xml', allowed: [200, 503] },
      { method: 'GET', path: '/robots.txt', allowed: [200, 503] },
      { method: 'GET', path: '/api/events', allowed: [200] },
      { method: 'GET', path: '/api/events/starten', allowed: [200, 401, 403, 404] },
      { method: 'GET', path: '/api/events/starten/photos', allowed: [200, 401, 403, 404] },
      { method: 'GET', path: '/api/events/starten/photos/01STAGEPRIVATE00000000000001', allowed: [200, 401, 403, 404] },
      { method: 'GET', path: '/api/tags', allowed: [200] },
      { method: 'GET', path: '/api/photos/featured', allowed: [200] },
      { method: 'GET', path: '/api/photos/most-favorited', allowed: [200] },
      { method: 'GET', path: '/api/events/by-tag/any-tag', allowed: [200] },
      { method: 'POST', path: '/api/photos/01STAGEPRIVATE00000000000001/favorite', allowed: [200, 404] },
    ];

    for (const c of checks) {
      const res = await req(c.method, `${cfg!.baseUrl}${c.path}`, {
        body: c.body,
      });
      expectOneOf(res.status, c.allowed, `${c.method} ${c.path}`);
    }
  });

  maybeIt('covers auth/session edge cases', async () => {
    const malformedToken = 'not-a-valid-jwt';

    const loginPageAnon = await req('GET', `${cfg!.baseUrl}/api/auth/login`);
    expectOneOf(loginPageAnon.status, [401], 'GET /api/auth/login anon');

    const logout = await req('GET', `${cfg!.baseUrl}/api/auth/logout`);
    expectOneOf(logout.status, [200, 301, 302, 307, 308], 'GET /api/auth/logout');

    const eventLoginMissingPassword = await req('POST', `${cfg!.baseUrl}/api/events/starten/login`, {
      body: {},
    });
    expectOneOf(eventLoginMissingPassword.status, [400], 'POST /api/events/:slug/login missing password');

    const eventLoginMalformedJson = await req('POST', `${cfg!.baseUrl}/api/events/starten/login`, {
      rawBody: 'not-json',
    });
    expectOneOf(eventLoginMalformedJson.status, [400, 500], 'POST /api/events/:slug/login malformed json');

    const mobileLogin = await req('GET', `${cfg!.baseUrl}/api/mobile-login?state=test-state`);
    expectOneOf(mobileLogin.status, [200, 503], 'GET /api/mobile-login');

    const mobileAuthAnon = await req('GET', `${cfg!.baseUrl}/api/mobile-auth?state=test-state`);
    expectOneOf(mobileAuthAnon.status, [401, 503], 'GET /api/mobile-auth anon');

    const mobileAuthMalformed = await req('GET', `${cfg!.baseUrl}/api/mobile-auth?state=test-state`, {
      token: malformedToken,
    });
    expectOneOf(mobileAuthMalformed.status, [401, 503], 'GET /api/mobile-auth malformed token');
  });

  maybeIt('covers media + zip auth matrix (anon/admin/collab/malformed)', async () => {
    const malformedToken = 'malformed.token.value';

    const privateAnon = await req('GET', cfg!.privateMediaUrl);
    expectOneOf(privateAnon.status, [401, 403, 404], 'private media anon');

    const privateMalformed = await req('GET', cfg!.privateMediaUrl, { token: malformedToken });
    expectOneOf(privateMalformed.status, [401, 403, 404], 'private media malformed token');

    const privateAdmin = await req('GET', cfg!.privateMediaUrl, { token: cfg!.adminToken });
    expectOneOf(privateAdmin.status, [200, 404], 'private media admin');

    const collabAnon = await req('GET', cfg!.collabMediaUrl);
    expectOneOf(collabAnon.status, [401, 403, 404], 'collab media anon');

    const collabMalformed = await req('GET', cfg!.collabMediaUrl, { token: malformedToken });
    expectOneOf(collabMalformed.status, [401, 403, 404], 'collab media malformed token');

    const collabAllowed = await req('GET', cfg!.collabMediaUrl, { token: cfg!.collabToken });
    expectOneOf(collabAllowed.status, [200, 404], 'collab media collaborator');

    const zipAnon = await req('POST', cfg!.privateZipUrl, { rawBody: cfg!.privateZipBody });
    expectOneOf(zipAnon.status, [401, 403, 404], 'private zip anon');

    const zipMalformed = await req('POST', cfg!.privateZipUrl, {
      token: malformedToken,
      rawBody: cfg!.privateZipBody,
    });
    expectOneOf(zipMalformed.status, [401, 403, 404], 'private zip malformed token');

    const zipAdmin = await req('POST', cfg!.privateZipUrl, {
      token: cfg!.adminToken,
      rawBody: cfg!.privateZipBody,
    });
    expectOneOf(zipAdmin.status, [200, 404], 'private zip admin');
  });

  maybeIt('covers authenticated user route families with role boundaries', async () => {
    const collaboratorProtected: Array<{ method: string; path: string; body?: unknown; allowedAnon: number[]; allowedAuthed: number[] }> = [
      { method: 'GET', path: '/api/favorites', allowedAnon: [401, 503], allowedAuthed: [200, 500, 503] },
      { method: 'GET', path: '/api/favorites/ids', allowedAnon: [401, 503], allowedAuthed: [200, 500, 503] },
      { method: 'POST', path: '/api/favorites/01STAGEPRIVATE00000000000001', allowedAnon: [401, 503], allowedAuthed: [200, 404, 500, 503] },
      { method: 'DELETE', path: '/api/favorites/01STAGEPRIVATE00000000000001', allowedAnon: [401, 503], allowedAuthed: [200, 404, 500, 503] },
      { method: 'GET', path: '/api/user/profile', allowedAnon: [200, 401, 503], allowedAuthed: [200, 500, 503] },
      { method: 'PUT', path: '/api/user/profile', body: { name: 'Staging User' }, allowedAnon: [401, 503], allowedAuthed: [200, 400, 500, 503] },
      { method: 'GET', path: '/api/user/collaborations', allowedAnon: [401, 503], allowedAuthed: [200, 500, 503] },

      { method: 'GET', path: '/api/events/thijs-x-dennis/collaborators', allowedAnon: [401, 503], allowedAuthed: [200, 403, 404, 503] },
      { method: 'POST', path: '/api/events/thijs-x-dennis/collaborators', body: { email: 'nobody@example.com' }, allowedAnon: [401, 503], allowedAuthed: [200, 400, 403, 404, 503] },
      { method: 'DELETE', path: '/api/events/thijs-x-dennis/collaborators/nobody%40example.com', allowedAnon: [401, 503], allowedAuthed: [200, 400, 403, 404, 503] },
      { method: 'PUT', path: '/api/events/thijs-x-dennis/collaborators/nobody%40example.com/role', body: { role: 'viewer' }, allowedAnon: [401, 503], allowedAuthed: [200, 400, 403, 404, 503] },
      { method: 'GET', path: '/api/users/search?q=thijs', allowedAnon: [401, 503], allowedAuthed: [200, 500, 503] },
      { method: 'GET', path: '/api/events/thijs-x-dennis/collaboration-history', allowedAnon: [401, 503], allowedAuthed: [200, 403, 404, 503] },
      { method: 'POST', path: '/api/events/thijs-x-dennis/invite-links', body: {}, allowedAnon: [401, 503], allowedAuthed: [200, 400, 403, 404, 503] },
      { method: 'GET', path: '/api/events/thijs-x-dennis/invite-links', allowedAnon: [401, 503], allowedAuthed: [200, 403, 404, 503] },
      { method: 'DELETE', path: '/api/events/thijs-x-dennis/invite-links/fake-token', allowedAnon: [401, 503], allowedAuthed: [200, 400, 403, 404, 503] },
      { method: 'POST', path: '/api/invite/fake-token/accept', body: {}, allowedAnon: [401, 503], allowedAuthed: [200, 400, 403, 404, 503] },
    ];

    for (const c of collaboratorProtected) {
      const anon = await req(c.method, `${cfg!.baseUrl}${c.path}`, { body: c.body });
      expectOneOf(anon.status, c.allowedAnon, `${c.method} ${c.path} anon`);

      const authed = await req(c.method, `${cfg!.baseUrl}${c.path}`, {
        token: cfg!.collabToken,
        body: c.body,
      });
      expectOneOf(authed.status, c.allowedAuthed, `${c.method} ${c.path} authed`);
    }
  }, 20000);

  maybeIt('covers admin route family unauthorized/authenticated boundaries', async () => {
    const adminRoutes: Array<{ method: string; path: string; body?: unknown; allowedAdmin: number[] }> = [
      { method: 'POST', path: '/api/admin/events', body: { name: 'Staging', slug: 'tmp-route-coverage' }, allowedAdmin: [200, 201, 400, 409, 500] },
      { method: 'PUT', path: '/api/admin/events/nonexistent-route-coverage', body: { name: 'No Event' }, allowedAdmin: [200, 400, 404, 500] },
      { method: 'DELETE', path: '/api/admin/events/nonexistent-route-coverage', allowedAdmin: [200, 400, 404, 500] },
      { method: 'POST', path: '/api/admin/events/nonexistent-route-coverage/tags', body: { tags: ['a'] }, allowedAdmin: [200, 400, 404, 500] },
      { method: 'POST', path: '/api/admin/events/nonexistent-route-coverage/regenerate-thumbnails', body: {}, allowedAdmin: [200, 400, 404, 500] },
      { method: 'POST', path: '/api/admin/events/nonexistent-route-coverage/geocode-photos', body: {}, allowedAdmin: [200, 400, 404, 500] },
      { method: 'PUT', path: '/api/admin/events/nonexistent-route-coverage/location', body: { city: 'Amsterdam' }, allowedAdmin: [200, 400, 404, 500] },

      { method: 'POST', path: '/api/admin/events/nonexistent-route-coverage/uploads/start', body: { fileName: 'x.jpg', fileType: 'image/jpeg', fileSize: 1 }, allowedAdmin: [200, 400, 404, 500] },
      { method: 'PUT', path: '/api/admin/events/nonexistent-route-coverage/uploads/01FAKE00000000000000000001/parts/1', body: {}, allowedAdmin: [200, 400, 404, 500] },
      { method: 'POST', path: '/api/admin/events/nonexistent-route-coverage/uploads/01FAKE00000000000000000001/complete', body: {}, allowedAdmin: [200, 400, 404, 500] },

      { method: 'PUT', path: '/api/admin/photos/01FAKE00000000000000000001/featured', body: { is_featured: true }, allowedAdmin: [200, 400, 404, 500] },
      { method: 'PUT', path: '/api/admin/photos/01FAKE00000000000000000001/replace', body: {}, allowedAdmin: [200, 400, 404, 500] },
      { method: 'DELETE', path: '/api/admin/photos/01FAKE00000000000000000001', allowedAdmin: [200, 400, 404, 500] },
      { method: 'POST', path: '/api/admin/photos/bulk-delete', body: { photoIds: [] }, allowedAdmin: [200, 400, 404, 500] },
      { method: 'POST', path: '/api/admin/photos/bulk-copy', body: { photoIds: [], targetEventSlug: 'starten' }, allowedAdmin: [200, 400, 404, 500] },

      { method: 'GET', path: '/api/admin/stats', allowedAdmin: [200, 404, 500] },
      { method: 'GET', path: '/api/admin/events/nonexistent-route-coverage/stats', allowedAdmin: [200, 404, 500] },
      { method: 'POST', path: '/api/admin/tags', body: { name: 'tmp' }, allowedAdmin: [200, 201, 400, 409, 500] },
      { method: 'PUT', path: '/api/admin/tags/1', body: { name: 'tmp2' }, allowedAdmin: [200, 400, 404, 500] },
      { method: 'DELETE', path: '/api/admin/tags/1', allowedAdmin: [200, 400, 404, 500] },
    ];

    for (const c of adminRoutes) {
      const anon = await req(c.method, `${cfg!.baseUrl}${c.path}`, { body: c.body });
      expectOneOf(anon.status, [401, 403], `${c.method} ${c.path} anon`);

      const malformed = await req(c.method, `${cfg!.baseUrl}${c.path}`, {
        token: 'bad-token',
        body: c.body,
      });
      expectOneOf(malformed.status, [401, 403], `${c.method} ${c.path} malformed token`);

      const admin = await req(c.method, `${cfg!.baseUrl}${c.path}`, {
        token: cfg!.adminToken,
        body: c.body,
      });
      expectOneOf(admin.status, c.allowedAdmin, `${c.method} ${c.path} admin`);
    }
  }, 30000);
});
