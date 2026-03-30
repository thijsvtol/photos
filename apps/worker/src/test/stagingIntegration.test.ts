import { describe, expect, it } from 'vitest';

type Config = {
  privateMediaUrl: string;
  collabMediaUrl: string;
  adminToken: string;
  collabToken: string;
  privateZipUrl: string;
  privateZipBody: string;
};

function readConfig(): Config | null {
  const privateMediaUrl = process.env.STAGING_PRIVATE_MEDIA_URL || '';
  const collabMediaUrl = process.env.STAGING_COLLAB_MEDIA_URL || '';
  const adminToken = process.env.STAGING_ADMIN_BEARER_TOKEN || '';
  const collabToken = process.env.STAGING_COLLAB_BEARER_TOKEN || '';
  const privateZipUrl = process.env.STAGING_PRIVATE_ZIP_URL || '';
  const privateZipBody = process.env.STAGING_PRIVATE_ZIP_BODY || '';

  const required = [
    privateMediaUrl,
    collabMediaUrl,
    adminToken,
    collabToken,
    privateZipUrl,
    privateZipBody,
  ];

  const hasPlaceholder = required.some((value) =>
    value.startsWith('__REPLACE_') || value.startsWith('CHANGE_ME')
  );

  const missing = required.some((value) => !value);

  if (missing || hasPlaceholder) {
    return null;
  }

  return {
    privateMediaUrl,
    collabMediaUrl,
    adminToken,
    collabToken,
    privateZipUrl,
    privateZipBody,
  };
}

async function statusForGet(url: string, token?: string): Promise<number> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { method: 'GET', headers });
  return res.status;
}

async function statusForZip(url: string, body: string, token?: string): Promise<number> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  return res.status;
}

const config = readConfig();
const maybeIt = config ? it : it.skip;

describe('Staging Integration Access Control', () => {
  maybeIt('denies anonymous media access', async () => {
    const privateAnon = await statusForGet(config!.privateMediaUrl);
    const collabAnon = await statusForGet(config!.collabMediaUrl);

    expect([401, 403]).toContain(privateAnon);
    expect([401, 403]).toContain(collabAnon);
  });

  maybeIt('allows role-based media access', async () => {
    const privateAdmin = await statusForGet(config!.privateMediaUrl, config!.adminToken);
    const collabAllowed = await statusForGet(config!.collabMediaUrl, config!.collabToken);

    expect(privateAdmin).toBe(200);
    expect(collabAllowed).toBe(200);
  });

  maybeIt('enforces ZIP access control', async () => {
    const privateZipAnon = await statusForZip(config!.privateZipUrl, config!.privateZipBody);
    const privateZipAdmin = await statusForZip(config!.privateZipUrl, config!.privateZipBody, config!.adminToken);

    expect([401, 403]).toContain(privateZipAnon);
    expect(privateZipAdmin).toBe(200);
  });
});
