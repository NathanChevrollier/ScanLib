import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { config } from './config.js';
import type { AppEnv } from './lib/context.js';
import { errorHandler } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { libraryRoutes } from './routes/library.js';
import { miscRoutes } from './routes/misc.js';
import { workRoutes } from './routes/works.js';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  app.use(
    '/api/*',
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  // Journal d'accès minimal : méthode, chemin, statut, durée.
  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    logger.debug('requête', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  app.onError(errorHandler);
  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Route inconnue.' } }, 404),
  );

  app.get('/api/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

  app.route('/api/auth', authRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/works', workRoutes);
  app.route('/api/library', libraryRoutes);
  app.route('/api', miscRoutes);

  return app;
}
