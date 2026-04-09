import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, closeDatabase } from './config/database.js';
import { ensureIndexes } from './config/db-indexes.js';
import { logger } from './shared/logger.js';
import type { Server } from 'http';

let server: Server | null = null;

async function startServer(): Promise<void> {
  try {
    // 1. Connect to MongoDB
    const db = await connectDatabase(config.DB_URI, config.DB_NAME);

    // 2. Ensure indexes
    await ensureIndexes(db);

    // 3. Create and start Express server
    const app = createApp();
    server = app.listen(config.PORT, () => {
      logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Server started');
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal');

  if (server) {
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Give in-flight requests 10 seconds to finish
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Forcing shutdown after timeout');
        resolve();
      }, 10000);

      server?.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // Close MongoDB connection
  await closeDatabase();

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
