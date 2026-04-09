import type { Db } from 'mongodb';
import { logger } from '../shared/logger.js';

/**
 * Creates all required indexes across collections.
 * Each sprint adds its collection's indexes here.
 * Called at startup after DB connection is established.
 */
export async function ensureIndexes(_db: Db): Promise<void> {
  logger.info('Index setup complete (no indexes to create in sprint 01)');
}
