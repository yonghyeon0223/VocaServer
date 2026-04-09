import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
} from '../../../src/shared/errors.js';

describe('AppError', () => {
  // U1
  it('is an instance of Error', () => {
    const error = new AppError(500, 'TEST_ERROR', 'test message');
    expect(error).toBeInstanceOf(Error);
  });

  // U10
  it('sets message correctly', () => {
    const error = new AppError(500, 'TEST_ERROR', 'my message');
    expect(error.message).toBe('my message');
  });

  // U9 (base)
  it('has isOperational set to true', () => {
    const error = new AppError(400, 'TEST', 'test');
    expect(error.isOperational).toBe(true);
  });
});

describe('ValidationError', () => {
  // U2
  it('has statusCode 400 and code VALIDATION_ERROR', () => {
    const error = new ValidationError('Bad input');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  // U11
  it('accepts a details array', () => {
    const details = [
      { field: 'email', message: 'Invalid email' },
      { field: 'name', message: 'Required' },
    ];
    const error = new ValidationError('Validation failed', details);
    expect(error.details).toEqual(details);
  });

  // U12 (partial — also checked below for all subclasses)
  it('is an instance of AppError', () => {
    const error = new ValidationError('Bad input');
    expect(error).toBeInstanceOf(AppError);
  });

  // U9 (partial)
  it('has isOperational set to true', () => {
    const error = new ValidationError('Bad input');
    expect(error.isOperational).toBe(true);
  });
});

describe('UnauthorizedError', () => {
  // U3
  it('has statusCode 401 and code UNAUTHORIZED', () => {
    const error = new UnauthorizedError('Not authenticated');
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('is an instance of AppError', () => {
    expect(new UnauthorizedError('msg')).toBeInstanceOf(AppError);
  });

  it('has isOperational set to true', () => {
    expect(new UnauthorizedError('msg').isOperational).toBe(true);
  });
});

describe('ForbiddenError', () => {
  // U4
  it('has statusCode 403 and code FORBIDDEN', () => {
    const error = new ForbiddenError('No access');
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('is an instance of AppError', () => {
    expect(new ForbiddenError('msg')).toBeInstanceOf(AppError);
  });

  it('has isOperational set to true', () => {
    expect(new ForbiddenError('msg').isOperational).toBe(true);
  });
});

describe('NotFoundError', () => {
  // U5
  it('has statusCode 404 and code RESOURCE_NOT_FOUND', () => {
    const error = new NotFoundError('Not here');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('is an instance of AppError', () => {
    expect(new NotFoundError('msg')).toBeInstanceOf(AppError);
  });

  it('has isOperational set to true', () => {
    expect(new NotFoundError('msg').isOperational).toBe(true);
  });
});

describe('ConflictError', () => {
  // U6
  it('has statusCode 409 and code DUPLICATE_ENTRY', () => {
    const error = new ConflictError('Already exists');
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('DUPLICATE_ENTRY');
  });

  it('is an instance of AppError', () => {
    expect(new ConflictError('msg')).toBeInstanceOf(AppError);
  });

  it('has isOperational set to true', () => {
    expect(new ConflictError('msg').isOperational).toBe(true);
  });
});

describe('RateLimitError', () => {
  // U7
  it('has statusCode 429 and code RATE_LIMITED', () => {
    const error = new RateLimitError('Too many requests');
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe('RATE_LIMITED');
  });

  it('is an instance of AppError', () => {
    expect(new RateLimitError('msg')).toBeInstanceOf(AppError);
  });

  it('has isOperational set to true', () => {
    expect(new RateLimitError('msg').isOperational).toBe(true);
  });
});

describe('InternalError', () => {
  // U8
  it('has statusCode 500 and code INTERNAL_ERROR', () => {
    const error = new InternalError('Something broke');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('is an instance of AppError', () => {
    expect(new InternalError('msg')).toBeInstanceOf(AppError);
  });

  it('has isOperational set to true', () => {
    expect(new InternalError('msg').isOperational).toBe(true);
  });
});
