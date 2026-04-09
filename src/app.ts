import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/env.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware.js';
import { rateLimiterMiddleware } from './middleware/rate-limiter.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { errorHandlerMiddleware } from './middleware/error-handler.middleware.js';
import { sendSuccess } from './shared/response.js';
import { getClient } from './config/database.js';

/**
 * Creates and configures the Express app.
 *
 * @param registerRoutes - Optional callback to register additional routes
 *   before the not-found/error-handler middleware. Used by tests to inject
 *   test-only routes.
 */
export function createApp(registerRoutes?: (app: Express) => void): Express {
  const app = express();

  // 1. Security headers
  app.use(helmet());

  // 2. CORS
  const origins = config.CORS_ORIGINS.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: origins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    }),
  );

  // 3. Body parsing
  app.use(express.json({ limit: '100kb' }));

  // 4. Request ID
  app.use(requestIdMiddleware);

  // 5. Request logging
  app.use(requestLoggerMiddleware);

  // 6. Health check (before rate limiter)
  app.get('/health', async (req, res) => {
    let dbStatus = 'disconnected';
    try {
      const client = getClient();
      await client.db().admin().command({ ping: 1 });
      dbStatus = 'connected';
    } catch {
      // getClient() throws if not initialized, or ping fails — DB is disconnected
    }

    const statusCode = dbStatus === 'connected' ? 200 : 503;
    sendSuccess(
      req,
      res,
      {
        status: dbStatus === 'connected' ? 'healthy' : 'degraded',
        uptime: process.uptime(),
        database: dbStatus,
        timestamp: new Date().toISOString(),
      },
      statusCode,
    );
  });

  // 7. Rate limiter (after health, before API routes)
  app.use(rateLimiterMiddleware);

  // 8. API routes (future sprints register here)
  // registerRoutes callback allows tests to inject routes at this point
  if (registerRoutes) {
    registerRoutes(app);
  }

  // 9. 404 catch-all
  app.use(notFoundMiddleware);

  // 10. Error handler (must be last)
  app.use(errorHandlerMiddleware);

  return app;
}
