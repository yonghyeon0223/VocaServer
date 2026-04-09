import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/setup.js';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Security headers (Helmet)', () => {
  // SH1
  it('response includes X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // SH2
  it('response includes X-Frame-Options header', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-frame-options']).toBeDefined();
  });

  // SH3
  it('response includes Strict-Transport-Security header', async () => {
    // Note: Helmet sets this by default even without HTTPS.
    // In production behind a reverse proxy, this is correct behavior.
    const res = await request(app).get('/health');

    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  // SH4
  it('response does NOT include X-Powered-By header', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
