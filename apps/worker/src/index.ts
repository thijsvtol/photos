import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { getConfig } from './config';
import { createLogger } from './logger';
import publicRoutes from './routes/public';
import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import adminRoutes from './routes/admin';
import zipRoutes from './routes/zip';
import featuresRoutes from './routes/features';
import favoritesRoutes from './routes/favorites';
import collaboratorsRoutes from './routes/collaborators';
import mobileAuthRoutes from './routes/mobileAuth';
import meRoutes from './routes/me';
import { seo } from './routes/seo';
import { runUploadNotifications, runStaleUploadCleanup, runTrashPurge } from './scheduled';
import { runAiEnrichment } from './aiEnrichment';
import { runFaceClustering } from './faceClustering';

const app = new Hono<{ Bindings: Env }>();

// Global request/response logging — mounted first so it wraps every other
// middleware and route below. This guarantees EVERY request gets logged at
// the right level regardless of whether the specific route handler logs
// anything itself: 5xx responses (and thrown errors) are logged at ERROR,
// 4xx responses at WARN, everything else at DEBUG (suppressed in production
// — see logger.ts — so normal 2xx/3xx traffic doesn't spam the log stream).
app.use('/*', async (c, next) => {
  const log = createLogger(c.env);
  const start = Date.now();
  const { method } = c.req;
  const path = c.req.path;

  try {
    await next();
  } catch (err) {
    const duration = Date.now() - start;
    log.error(`[${method} ${path}] threw after ${duration}ms:`, err);
    throw err; // Re-throw so app.onError still runs and produces the response.
  }

  const duration = Date.now() - start;
  const status = c.res?.status ?? 0;
  const line = `[${method} ${path}] -> ${status} (${duration}ms)`;
  if (status >= 500) {
    log.error(line);
  } else if (status >= 400) {
    log.warn(line);
  } else {
    log.debug(line);
  }
});

// Global CORS middleware - configured per request to read env vars
app.use('/*', async (c, next) => {
  const config = getConfig(c.env);
  const allowedOrigins = [
    `https://${config.domain}`,
    'https://localhost',      // Capacitor Android
    'capacitor://localhost',  // Capacitor iOS
    'http://localhost:5173',  // Local development
  ];

  return cors({
    origin: (origin) => {
      // Allow requests with no origin (same-origin) or from allowed list
      if (!origin || allowedOrigins.includes(origin)) {
        return origin || '*';
      }
      return allowedOrigins[0]; // Fallback to production domain
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Access', 'Cf-Access-Jwt-Assertion', 'X-Upload-Id', 'X-File-Type', 'X-Event-Session', 'X-Event-Sessions'],
  })(c, next);
});

// Mount route modules
app.route('/', publicRoutes);
app.route('/', authRoutes);
app.route('/', mediaRoutes);
app.route('/api/admin', adminRoutes);
app.route('/', zipRoutes);
app.route('/', featuresRoutes);
app.route('/', favoritesRoutes);
app.route('/', collaboratorsRoutes);
app.route('/', mobileAuthRoutes);
app.route('/', meRoutes);
app.route('/', seo);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler — the request-logging middleware above already logs this at
// WARN (status 404), so no separate logging needed here.
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Global error handler — logs full error context (method, path, stack) at
// ERROR level before returning a generic 500 (never leaks internals to the
// client). The request-logging middleware above ALSO logs a one-line summary
// for the same failure; this handler adds the full stack trace for
// debugging.
app.onError((err, c) => {
  const log = createLogger(c.env);
  log.error(`Unhandled error in [${c.req.method} ${c.req.path}]:`, err instanceof Error ? err.stack || err.message : err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  // Hourly cron: batch new-photo notifications to collaborators, and clean
  // up stale incomplete uploads (see wrangler.toml [triggers]). Neither task
  // previously caught its own errors, so a thrown exception would become an
  // unlogged (from our own logger's perspective) unhandled rejection inside
  // waitUntil — wrap each in try/catch so cron failures are always logged at
  // ERROR level, same as request-handling failures above.
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    const log = createLogger(env);
    ctx.waitUntil(
      runUploadNotifications(env).catch((err) => log.error('Scheduled runUploadNotifications failed:', err))
    );
    ctx.waitUntil(
      runStaleUploadCleanup(env).catch((err) => log.error('Scheduled runStaleUploadCleanup failed:', err))
    );
    ctx.waitUntil(
      runTrashPurge(env).catch((err) => log.error('Scheduled runTrashPurge failed:', err))
    );
    ctx.waitUntil(
      runAiEnrichment(env).catch((err) => log.error('Scheduled runAiEnrichment failed:', err))
    );
    ctx.waitUntil(
      runFaceClustering(env).catch((err) => log.error('Scheduled runFaceClustering failed:', err))
    );
  },
};
