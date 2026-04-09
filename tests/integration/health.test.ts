import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getTestApp, setupTestDb, teardownTestDb } from '../helpers/setup.js';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  await setupTestDb();
  app = await getTestApp();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('GET /health', () => {
  // H1
  it('returns 200 with healthy status when DB is connected', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.database).toBe('connected');
    expect(res.body.data.uptime).toBeGreaterThan(0);
  });

  // H2
  it('has correct response envelope shape', async () => {
    const res = await request(app).get('/health');

    expect(res.body).toHaveProperty('success');
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('requestId');
    expect(res.body.meta).toHaveProperty('timestamp');
  });

  // H3
  it('meta.timestamp is a valid ISO 8601 string', async () => {
    const res = await request(app).get('/health');

    const parsed = new Date(res.body.meta.timestamp);
    expect(parsed.toString()).not.toBe('Invalid Date');
  });

  // H4
  it('meta.requestId starts with req_', async () => {
    const res = await request(app).get('/health');

    expect(res.body.meta.requestId).toMatch(/^req_/);
  });

  // H6
  it('uptime is a number, not a string', async () => {
    const res = await request(app).get('/health');

    expect(typeof res.body.data.uptime).toBe('number');
  });

  // H7
  it('response includes X-Request-Id header matching body', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
  });

  // H8
  it('POST /health returns 404 (only GET is allowed)', async () => {
    const res = await request(app).post('/health');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  // H9
  it('GET /health with query params still works', async () => {
    const res = await request(app).get('/health?foo=bar&baz=123');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('healthy');
  });
});

describe('GET /health — DB disconnected', () => {
  // H5
  it('returns 503 with degraded status when DB is disconnected', async () => {
    // Close the DB connection to simulate disconnection
    await teardownTestDb();

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.database).toBe('disconnected');

    // Reconnect for any subsequent tests
    await setupTestDb();
  });
});
