import type { Request, Response } from 'express';
import type { PaginationMeta, ValidationErrorDetail } from './types.js';

export function sendSuccess<T>(
  req: Request,
  res: Response,
  data: T,
  statusCode = 200,
): void {
  res.status(statusCode).json({
    success: true,
    data,
    meta: {
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    },
  });
}

export function sendPaginatedSuccess<T>(
  req: Request,
  res: Response,
  data: T[],
  pagination: PaginationMeta,
): void {
  res.status(200).json({
    success: true,
    data,
    meta: {
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      pagination,
    },
  });
}

export function sendError(
  req: Request,
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: ValidationErrorDetail[],
): void {
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    meta: {
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    },
  });
}
