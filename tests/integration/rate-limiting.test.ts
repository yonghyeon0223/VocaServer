import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * Rate limiting tests use a custom app with a very low limit (max 2 per window)
 * to make testing practical. We override the rate limit config for these tests.
 */

let app: Express;

beforeAll(async () => {
  // Set low rate limit before importing app
  process.env['RATE_LIMIT_MAX_REQUESTS'] = '5';
  process.env['RATE_LIMIT_WINDOW_MS'] = '60000';

  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

describe('Rate limiting', () => {
  // R1 — draft-7 uses a combined `ratelimit` header: "limit=N, remaining=N, reset=N"
  it('request within limit includes rate limit headers', async () => {
    const res = await request(app).get('/api/v1/nonexistent');

    // draft-7 standard: single `ratelimit` header + `ratelimit-policy`
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  // R2
  it('remaining count decreases with each request', async () => {
    const res1 = await request(app).get('/api/v1/test-rate-1');
    const res2 = await request(app).get('/api/v1/test-rate-2');

    // Parse "limit=2, remaining=N, reset=N" format
    const parseRemaining = (header: string) => {
      const match = /remaining=(\d+)/.exec(header);
      return match ? parseInt(match[1]!, 10) : NaN;
    };

    const remaining1 = parseRemaining(res1.headers['ratelimit'] as string);
    const remaining2 = parseRemaining(res2.headers['ratelimit'] as string);

    expect(remaining2).toBeLessThan(remaining1);
  });

  // R3
  it('requests exceeding limit get 429 with correct error envelope', async () => {
    // Exhaust the rate limit (may already be partially exhausted from above tests)
    for (let i = 0; i < 5; i++) {
      await request(app).get(`/api/v1/exhaust-${i}`);
    }

    const res = await request(app).get('/api/v1/should-be-limited');

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('requestId');
  });

  // R4
  it('GET /health is NOT rate-limited', async () => {
    // Rate limit should already be exhausted from R3
    // But health should still work
    const res = await request(app).get('/health');

    expect(res.status).not.toBe(429);
    // Health returns 200 (or 503 if no DB) — but never 429
    expect([200, 503]).toContain(res.status);
  });
});
