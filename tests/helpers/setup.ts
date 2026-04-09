/**
 * Test setup helpers.
 *
 * Provides a configured Express app instance for integration tests
 * and manages a test MongoDB connection.
 *
 * Usage in integration tests:
 *   import { getTestApp, setupTestDb, teardownTestDb } from '../helpers/setup.js';
 */

import type { Express } from 'express';

let app: Express | null = null;

/**
 * Returns a configured Express app for integration tests.
 * Lazily creates the app on first call — all tests in the same file
 * share the same instance (Supertest doesn't start a real server).
 */
export async function getTestApp(): Promise<Express> {
  if (!app) {
    // Dynamically import to avoid loading app before env is configured
    const { createApp } = await import('../../src/app.js');
    app = createApp();
  }
  return app;
}

/**
 * Resets the cached app instance.
 * Call this in afterEach/afterAll if a test modifies the app.
 */
export function resetTestApp(): void {
  app = null;
}

/**
 * Connects to the test MongoDB instance.
 * Uses DB_URI from env with DB_NAME overridden to 'voca_test'.
 */
export async function setupTestDb(): Promise<void> {
  const { connectDatabase } = await import('../../src/config/database.js');
  const uri = process.env['DB_URI'] ?? 'mongodb://localhost:27017';
  await connectDatabase(uri, 'voca_test');
}

/**
 * Drops the test database and closes the connection.
 */
export async function teardownTestDb(): Promise<void> {
  const { getDb, closeDatabase } = await import('../../src/config/database.js');
  try {
    const db = getDb();
    await db.dropDatabase();
  } catch {
    // DB may not be connected — that's fine during teardown
  }
  await closeDatabase();
}
