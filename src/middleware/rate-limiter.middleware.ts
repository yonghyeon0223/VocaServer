import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';
import { sendError } from '../shared/response.js';

export const rateLimiterMiddleware = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    sendError(req, res, 429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  },
});
