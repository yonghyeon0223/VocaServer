import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/setup.js';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Response Content-Type', () => {
  // CT1
  it('success response has Content-Type application/json', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  // CT2
  it('error response has Content-Type application/json', async () => {
    const res = await request(app).get('/nonexistent-route');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
