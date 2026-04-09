import type { ValidationErrorDetail } from './types.js';

export class AppError extends Error {
  public readonly isOperational = true;

  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: ValidationErrorDetail[],
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: ValidationErrorDetail[]) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'RESOURCE_NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'DUPLICATE_ENTRY', message);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string) {
    super(429, 'RATE_LIMITED', message);
  }
}

export class InternalError extends AppError {
  constructor(message: string) {
    super(500, 'INTERNAL_ERROR', message);
  }
}
