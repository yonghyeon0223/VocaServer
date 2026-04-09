import pino from 'pino';
import { config } from '../config/env.js';

const transport =
  config.NODE_ENV === 'development'
    ? pino.transport({ target: 'pino-pretty' })
    : undefined;

export const logger = pino(
  {
    level: config.LOG_LEVEL,
  },
  transport,
);
