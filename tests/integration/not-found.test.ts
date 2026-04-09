import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/setup.js';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('404 catch-all', () => {
  // N1
  it('GET /nonexistent returns 404', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  // N2
  it('error message includes method and path', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.body.error.message).toContain('GET');
    expect(res.body.error.message).toContain('/nonexistent');
  });

  // N3
  it('has correct error envelope shape', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('requestId');
    expect(res.body.meta).toHaveProperty('timestamp');
  });

  // N4
  it('POST /nonexistent returns 404', async () => {
    const res = await request(app).post('/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('POST');
  });

  // N5
  it('PUT /nonexistent returns 404', async () => {
    const res = await request(app).put('/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('PUT');
  });

  // N6
  it('DELETE /nonexistent returns 404', async () => {
    const res = await request(app).delete('/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('DELETE');
  });

  // N7
  it('GET /api/v1/nonexistent returns 404', async () => {
    const res = await request(app).get('/api/v1/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  // N8
  it('deeply nested path returns 404', async () => {
    const res = await request(app).get('/a/very/deep/nested/path');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('/a/very/deep/nested/path');
  });

  // N9
  it('path with query params returns 404', async () => {
    const res = await request(app).get('/nonexistent?with=query&params=true');

    expect(res.status).toBe(404);
  });

  // N10
  it('path with encoded special characters returns 404', async () => {
    const res = await request(app).get('/path%20with%20spaces');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
