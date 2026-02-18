import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { getConfig } from './config';
import publicRoutes from './routes/public';
import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import adminRoutes from './routes/admin';
import zipRoutes from './routes/zip';
import featuresRoutes from './routes/features';
import favoritesRoutes from './routes/favorites';
import collaboratorsRoutes from './routes/collaborators';
import mobileAuthRoutes from './routes/mobileAuth';
import { seo } from './routes/seo';

const app = new Hono<{ Bindings: Env }>();

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
    allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Access', 'Cf-Access-Jwt-Assertion', 'X-Upload-Id', 'X-File-Type'],
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
