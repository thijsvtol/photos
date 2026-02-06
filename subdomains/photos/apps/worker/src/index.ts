import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import publicRoutes from './routes/public';
import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import adminRoutes from './routes/admin';
import zipRoutes from './routes/zip';
import featuresRoutes from './routes/features';
import { seo } from './routes/seo';

const app = new Hono<{ Bindings: Env }>();

// Global CORS for all routes
app.use('/*', cors({
  origin: (origin) => origin, // Allow same origin
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Access'],
}));

// Mount route modules
app.route('/', publicRoutes);
app.route('/', authRoutes);
app.route('/', mediaRoutes);
app.route('/api/admin', adminRoutes);
app.route('/', zipRoutes);
app.route('/', featuresRoutes);
app.route('/', seo);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
