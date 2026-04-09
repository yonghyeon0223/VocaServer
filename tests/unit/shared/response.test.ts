import { describe, it, expect, vi } from 'vitest';
import { sendSuccess, sendPaginatedSuccess, sendError } from '../../../src/shared/response.js';
import type { Request, Response } from 'express';

function createMockReqRes() {
  const req = {
    requestId: 'req_test-1234-5678-9abc-def012345678',
  } as unknown as Request;

  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnThis();
  const res = {
    status: statusFn,
    json: jsonFn,
  } as unknown as Response;

  return { req, res, statusFn, jsonFn };
}

describe('sendSuccess', () => {
  // S1
  it('produces correct success envelope', () => {
    const { req, res, jsonFn } = createMockReqRes();
    sendSuccess(req, res, { id: 1, name: 'test' });

    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 1, name: 'test' });
    expect(body.meta).toBeDefined();

    const meta = body.meta as Record<string, unknown>;
    expect(meta.requestId).toBe('req_test-1234-5678-9abc-def012345678');
    expect(meta.timestamp).toBeDefined();
  });

  // S2
  it('defaults to status 200', () => {
    const { req, res, statusFn } = createMockReqRes();
    sendSuccess(req, res, { ok: true });

    expect(statusFn).toHaveBeenCalledWith(200);
  });

  // S3
  it('accepts custom status code', () => {
    const { req, res, statusFn } = createMockReqRes();
    sendSuccess(req, res, { created: true }, 201);

    expect(statusFn).toHaveBeenCalledWith(201);
  });

  // S8
  it('meta.timestamp is a valid ISO 8601 string', () => {
    const { req, res, jsonFn } = createMockReqRes();
    sendSuccess(req, res, {});

    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    const meta = body.meta as Record<string, string>;
    const parsed = new Date(meta.timestamp!);
    expect(parsed.toString()).not.toBe('Invalid Date');
  });

  // S9
  it('meta.requestId comes from req.requestId', () => {
    const { req, res, jsonFn } = createMockReqRes();
    sendSuccess(req, res, {});

    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    const meta = body.meta as Record<string, string>;
    expect(meta.requestId).toBe(req.requestId);
  });
});

describe('sendPaginatedSuccess', () => {
  // S4
  it('includes pagination in meta', () => {
    const { req, res, jsonFn } = createMockReqRes();
    const pagination = { page: 2, limit: 20, total: 142, totalPages: 8 };
    sendPaginatedSuccess(req, res, [{ id: 1 }, { id: 2 }], pagination);

    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ id: 1 }, { id: 2 }]);

    const meta = body.meta as Record<string, unknown>;
    expect(meta.pagination).toEqual(pagination);
  });
});

describe('sendError', () => {
  // S5
  it('produces correct error envelope', () => {
    const { req, res, jsonFn } = createMockReqRes();
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Bad input');

    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.success).toBe(false);

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Bad input');

    const meta = body.meta as Record<string, unknown>;
    expect(meta.requestId).toBeDefined();
    expect(meta.timestamp).toBeDefined();
  });

  // S6
  it('includes details when provided', () => {
    const { req, res, jsonFn } = createMockReqRes();
    const details = [{ field: 'email', message: 'Invalid' }];
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Bad input', details);

    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    const error = body.error as Record<string, unknown>;
    expect(error.details).toEqual(details);
  });

  // S7
  it('omits details when not provided', () => {
    const { req, res, jsonFn } = createMockReqRes();
    sendError(req, res, 500, 'INTERNAL_ERROR', 'Boom');

    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    const error = body.error as Record<string, unknown>;
    expect(error.details).toBeUndefined();
  });
});
