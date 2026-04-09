import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/setup.js';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('CORS', () => {
  // C1
  it('request with allowed Origin gets Access-Control-Allow-Origin', async () => {
    const allowedOrigin = process.env['CORS_ORIGINS'] ?? 'http://localhost:3000';
    const res = await request(app)
      .get('/health')
      .set('Origin', allowedOrigin);

    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  // C2
  it('preflight OPTIONS request returns CORS headers', async () => {
    const allowedOrigin = process.env['CORS_ORIGINS'] ?? 'http://localhost:3000';
    const res = await request(app)
      .options('/health')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['access-control-allow-methods']).toBeDefined();
  });

  // C3
  it('request with disallowed Origin does not get Access-Control-Allow-Origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://evil-site.com');

    // The header should either be absent or not match the disallowed origin
    const header = res.headers['access-control-allow-origin'];
    expect(header).not.toBe('http://evil-site.com');
  });
});
