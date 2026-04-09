import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/setup.js';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Request ID tracking', () => {
  // I1
  it('response has X-Request-Id header', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toBeDefined();
  });

  // I2
  it('X-Request-Id header matches meta.requestId in body', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
  });

  // I3
  it('auto-generated ID has req_ + UUID v4 format', async () => {
    const res = await request(app).get('/health');

    expect(res.body.meta.requestId).toMatch(
      /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  // I4
  it('uses client-provided X-Request-Id', async () => {
    const res = await request(app)
      .get('/health')
      .set('X-Request-Id', 'custom-id-123');

    expect(res.body.meta.requestId).toBe('custom-id-123');
    expect(res.headers['x-request-id']).toBe('custom-id-123');
  });

  // I5
  it('each request gets a unique ID', async () => {
    const res1 = await request(app).get('/health');
    const res2 = await request(app).get('/health');

    expect(res1.body.meta.requestId).not.toBe(res2.body.meta.requestId);
  });

  // I6
  it('generates own ID when X-Request-Id header is empty', async () => {
    const res = await request(app)
      .get('/health')
      .set('X-Request-Id', '');

    expect(res.body.meta.requestId).not.toBe('');
    expect(res.body.meta.requestId).toMatch(/^req_/);
  });
});
