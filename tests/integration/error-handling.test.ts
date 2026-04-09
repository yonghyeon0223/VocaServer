import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { registerTestErrorRoutes } from '../helpers/test-error-routes.js';

/**
 * These tests use a dedicated app instance with test error routes registered
 * BEFORE the not-found and error-handler middleware. We import createApp and
 * inject the test routes into the middleware chain.
 */

let app: express.Express;

beforeAll(async () => {
  const { createApp } = await import('../../src/app.js');
  app = createApp((expressApp) => {
    // Register test error routes before the not-found/error-handler middleware
    registerTestErrorRoutes(expressApp);
  });
});

describe('Error handling middleware', () => {
  // E1
  it('ValidationError returns 400 with VALIDATION_ERROR code and details', async () => {
    const res = await request(app).get('/test-errors/validation');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { field: 'email', message: 'Invalid email format' },
      { field: 'password', message: 'Must be at least 8 characters' },
    ]);
  });

  // E2
  it('UnauthorizedError returns 401 with UNAUTHORIZED code', async () => {
    const res = await request(app).get('/test-errors/unauthorized');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // E3
  it('ForbiddenError returns 403 with FORBIDDEN code', async () => {
    const res = await request(app).get('/test-errors/forbidden');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  // E4
  it('NotFoundError returns 404 with RESOURCE_NOT_FOUND code', async () => {
    const res = await request(app).get('/test-errors/not-found');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  // E5
  it('ConflictError returns 409 with DUPLICATE_ENTRY code', async () => {
    const res = await request(app).get('/test-errors/conflict');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DUPLICATE_ENTRY');
  });

  // E6
  it('all error responses have correct envelope shape', async () => {
    const res = await request(app).get('/test-errors/unauthorized');

    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('requestId');
    expect(res.body.meta).toHaveProperty('timestamp');
  });

  // E7
  it('plain Error returns generic 500 without leaking internal details', async () => {
    const res = await request(app).get('/test-errors/plain-error');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    // Should NOT contain the actual error message in production-like behavior
    expect(res.body.error.message).not.toContain('Something unexpected broke');
  });

  // E8
  it('thrown string is handled gracefully as 500', async () => {
    const res = await request(app).get('/test-errors/string-throw');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  // E9
  it('AppError with custom details includes the details array', async () => {
    const res = await request(app).get('/test-errors/app-error-with-details');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CUSTOM_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'name', message: 'Too long' }]);
  });

  // E10
  it('error responses have Content-Type application/json', async () => {
    const res = await request(app).get('/test-errors/plain-error');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  // E11
  it('async rejection is caught by Express 5 and returns proper 500', async () => {
    const res = await request(app).get('/test-errors/async-rejection');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  // E12
  it('error with no message still produces valid response', async () => {
    const res = await request(app).get('/test-errors/no-message');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBeDefined();
    expect(typeof res.body.error.message).toBe('string');
  });
});
