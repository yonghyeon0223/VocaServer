import type { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const clientId = req.get('X-Request-Id');
  const requestId = clientId && clientId.length > 0 ? clientId : `req_${uuidv4()}`;

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
};
