import { describe, it, expect, vi } from 'vitest';
import { requestIdMiddleware } from '../../../src/middleware/request-id.middleware.js';
import type { Request, Response, NextFunction } from 'express';

function createMocks(headers: Record<string, string> = {}) {
  const req = {
    headers: { ...headers },
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;

  const setHeaderFn = vi.fn();
  const res = {
    setHeader: setHeaderFn,
  } as unknown as Response;

  const next = vi.fn() as unknown as NextFunction;

  return { req, res, next, setHeaderFn };
}

describe('requestIdMiddleware', () => {
  // M1
  it('generates req_ + UUID when no header provided', () => {
    const { req, res, next } = createMocks();
    requestIdMiddleware(req, res, next);

    expect(req.requestId).toMatch(
      /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  // M2
  it('uses client-provided X-Request-Id', () => {
    const { req, res, next } = createMocks({ 'x-request-id': 'client-id-123' });
    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe('client-id-123');
  });

  // M3
  it('sets X-Request-Id response header', () => {
    const { req, res, next, setHeaderFn } = createMocks();
    requestIdMiddleware(req, res, next);

    expect(setHeaderFn).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  // M4
  it('generates own ID when X-Request-Id header is empty', () => {
    const { req, res, next } = createMocks({ 'x-request-id': '' });
    requestIdMiddleware(req, res, next);

    expect(req.requestId).not.toBe('');
    expect(req.requestId).toMatch(/^req_/);
  });

  // M5
  it('calls next()', () => {
    const { req, res, next } = createMocks();
    requestIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
