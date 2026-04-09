import type { PaginationParams, PaginationMeta } from './types.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  let page = Math.floor(Number(query.page));
  let limit = Math.floor(Number(query.limit));

  if (!Number.isFinite(page) || page < 1) {
    page = DEFAULT_PAGE;
  }

  if (!Number.isFinite(limit)) {
    limit = DEFAULT_LIMIT;
  } else if (limit < MIN_LIMIT) {
    limit = MIN_LIMIT;
  } else if (limit > MAX_LIMIT) {
    limit = MAX_LIMIT;
  }

  return { page, limit };
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

export function calculateSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}
