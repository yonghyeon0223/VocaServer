import type { Logger } from 'pino';

// ---- Response Envelope Types ----

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ValidationErrorDetail[];
  };
  meta: ResponseMeta;
}

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
}

// ---- Pagination Input ----

export interface PaginationParams {
  page: number;
  limit: number;
}

// ---- Express Augmentation ----

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
    }
  }
}
