import type { RequestHandler } from 'express';
import { sendError } from '../shared/response.js';

export const notFoundMiddleware: RequestHandler = (req, res) => {
  sendError(
    req,
    res,
    404,
    'RESOURCE_NOT_FOUND',
    `The requested resource was not found: ${req.method} ${req.path}`,
  );
};
