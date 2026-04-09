import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type express from 'express';

/**
 * Body parsing tests need a POST route to receive bodies.
 * We create a custom app with a test route that echoes the body.
 */

let app: express.Express;

beforeAll(async () => {
  const { createApp } = await import('../../src/app.js');
  app = createApp((expressApp) => {
    // Simple echo route for testing body parsing
    expressApp.post('/test-echo', (req, res) => {
      res.json({ success: true, data: req.body, meta: { requestId: req.requestId, timestamp: new Date().toISOString() } });
    });
  });
});

describe('Body parsing', () => {
  // B1
  it('POST with body >100kb returns 413', async () => {
    const largeBody = { data: 'x'.repeat(200 * 1024) }; // ~200kb

    const res = await request(app)
      .post('/test-echo')
      .send(largeBody)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(413);
    // Should be a JSON error response, not Express default
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
  });

  // B2
  it('POST with malformed JSON returns 400 with JSON error envelope', async () => {
    const res = await request(app)
      .post('/test-echo')
      .send('{invalid json}')
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
  });

  // B3
  it('POST with valid JSON body within limit succeeds', async () => {
    const res = await request(app)
      .post('/test-echo')
      .send({ message: 'hello' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ message: 'hello' });
  });
});
