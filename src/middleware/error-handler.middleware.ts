import type { ErrorRequestHandler } from 'express';
import { AppError } from '../shared/errors.js';
import { sendError } from '../shared/response.js';
import { config } from '../config/env.js';
import { logger } from '../shared/logger.js';

export const errorHandlerMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  // Guard: if err is not an object, treat as generic 500
  if (typeof err !== 'object' || err === null) {
    const log = req.log ?? logger;
    log.error({ err: String(err) }, 'Non-error thrown');
    sendError(req, res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    return;
  }

  // Handle JSON parse errors from express.json()
  if ('type' in err && err.type === 'entity.parse.failed') {
    sendError(req, res, 400, 'BAD_REQUEST', 'Malformed JSON in request body');
    return;
  }

  // Handle body size limit errors from express.json()
  if ('type' in err && err.type === 'entity.too.large') {
    sendError(req, res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit');
    return;
  }

  // Operational errors — expected, send structured response
  if (err instanceof AppError) {
    sendError(req, res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  // Programmer errors — unexpected, log and send generic response
  const log = req.log ?? logger;
  log.error({ err }, 'Unhandled error');

  const message =
    config.NODE_ENV === 'development'
      ? (err instanceof Error ? err.message : 'An unexpected error occurred')
      : 'An unexpected error occurred';

  sendError(req, res, 500, 'INTERNAL_ERROR', message);
};
