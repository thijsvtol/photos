import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAdmin, requireUploadPermission } from '../auth';
import eventsRouter from './admin/events';
import uploadsRouter from './admin/uploads';
import photosRouter from './admin/photos';
import analyticsRouter from './admin/analytics';
import tagsRouter from './admin/tags';
import utilitiesRouter from './admin/utilities';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply conditional admin authentication
// Upload routes and per-event stats handle their own permission checks
// (stats must also be readable by non-admin collaborators, e.g. on the upload page).
const eventStatsPathPattern = /\/events\/[^/]+\/stats$/;
app.use('/*', async (c, next) => {
  const path = c.req.path;
  if (path.includes('/uploads/') || eventStatsPathPattern.test(path)) {
    await next();
  } else {
    return requireAdmin(c, next);
  }
});

// Mount sub-routers
app.route('/events', eventsRouter);
app.route('/events/:slug/uploads', uploadsRouter);
app.route('/photos', photosRouter);
app.route('/stats', analyticsRouter);
app.route('/tags', tagsRouter);
app.route('/events/:slug', utilitiesRouter);

export default app;
