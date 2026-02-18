import type { TestEnv } from './types';
import { MockD1Database } from './database';
import { createBucket } from './r2bucket';

export function createEnv(db: MockD1Database): TestEnv {
  return {
    DB: db as unknown as D1Database,
    PHOTOS_BUCKET: createBucket() as unknown as R2Bucket,
    EVENT_COOKIE_SECRET: 'event-secret',
    ADMIN_EMAILS: 'admin@example.com',
    JWT_SECRET: 'jwt-secret',
    APP_NAME: 'Photos',
    BRAND_NAME: 'Photos',
    COPYRIGHT_HOLDER: 'Photos',
    APP_DOMAIN: 'photos.example.com',
    CONTACT_EMAIL: 'hello@example.com',
    ENVIRONMENT: 'development',
    MAILGUN_API_KEY: 'test-key',
    MAILGUN_DOMAIN: 'example.com',
  };
}
