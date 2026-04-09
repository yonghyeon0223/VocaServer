/**
 * Test-only routes that throw specific errors.
 * Registered on the Express app during error-handling integration tests
 * to verify the error handler middleware produces correct responses.
 */

import type { Express } from 'express';
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  AppError,
} from '../../src/shared/errors.js';

/**
 * Registers routes under /test-errors/* that throw specific error types.
 * These routes should only be used in tests — never registered in production.
 */
export function registerTestErrorRoutes(app: Express): void {
  app.get('/test-errors/validation', () => {
    throw new ValidationError('Validation failed', [
      { field: 'email', message: 'Invalid email format' },
      { field: 'password', message: 'Must be at least 8 characters' },
    ]);
  });

  app.get('/test-errors/unauthorized', () => {
    throw new UnauthorizedError('Invalid credentials');
  });

  app.get('/test-errors/forbidden', () => {
    throw new ForbiddenError('Insufficient permissions');
  });

  app.get('/test-errors/not-found', () => {
    throw new NotFoundError('User not found');
  });

  app.get('/test-errors/conflict', () => {
    throw new ConflictError('Email already exists');
  });

  app.get('/test-errors/app-error-with-details', () => {
    throw new AppError(422, 'CUSTOM_ERROR', 'Custom error with details', [
      { field: 'name', message: 'Too long' },
    ]);
  });

  // Throws a plain Error (not AppError) — simulates programmer error
  app.get('/test-errors/plain-error', () => {
    throw new Error('Something unexpected broke');
  });

  // Throws a string (not even an Error object)
  app.get('/test-errors/string-throw', () => {
    throw 'raw string error';
  });

  // Async route that rejects — Express 5 should catch this
  app.get('/test-errors/async-rejection', async () => {
    await Promise.reject(new Error('Async operation failed'));
  });

  // Throws error with no message
  app.get('/test-errors/no-message', () => {
    throw new Error();
  });
}
