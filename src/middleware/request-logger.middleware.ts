import type { IncomingMessage } from 'http';
import type { Options } from 'pino-http';
import { pinoHttp } from 'pino-http';
import { logger } from '../shared/logger.js';

const options: Options = {
  logger,
  genReqId: (req: IncomingMessage) =>
    (req as IncomingMessage & { requestId: string }).requestId,
  customProps: (req: IncomingMessage) => ({
    requestId: (req as IncomingMessage & { requestId: string }).requestId,
  }),
  autoLogging: {
    ignore: (req: IncomingMessage) => req.url === '/health',
  },
};

export const requestLoggerMiddleware = pinoHttp(options);
