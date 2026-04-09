import { describe, it, expect } from 'vitest';
import {
  parsePagination,
  buildPaginationMeta,
  calculateSkip,
} from '../../../src/shared/pagination.js';

describe('parsePagination', () => {
  // P1
  it('returns defaults when no query params provided', () => {
    const result = parsePagination({});
    expect(result).toEqual({ page: 1, limit: 20 });
  });

  // P2
  it('parses custom page and limit', () => {
    const result = parsePagination({ page: '3', limit: '50' });
    expect(result).toEqual({ page: 3, limit: 50 });
  });

  // P3
  it('clamps limit to max 100', () => {
    const result = parsePagination({ limit: '200' });
    expect(result.limit).toBe(100);
  });

  // P4
  it('clamps limit to min 1', () => {
    const result = parsePagination({ limit: '0' });
    expect(result.limit).toBe(1);
  });

  // P5
  it('clamps negative limit to 1', () => {
    const result = parsePagination({ limit: '-5' });
    expect(result.limit).toBe(1);
  });

  // P6
  it('clamps negative page to 1', () => {
    const result = parsePagination({ page: '-1' });
    expect(result.page).toBe(1);
  });

  // P7
  it('returns defaults for non-numeric values', () => {
    const result = parsePagination({ page: 'abc', limit: 'xyz' });
    expect(result).toEqual({ page: 1, limit: 20 });
  });

  // P8
  it('floors float values', () => {
    const result = parsePagination({ page: '2.7', limit: '10.9' });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
  });
});

describe('buildPaginationMeta', () => {
  // P9
  it('calculates totalPages correctly (ceiling division)', () => {
    const meta = buildPaginationMeta(1, 20, 142);
    expect(meta).toEqual({
      page: 1,
      limit: 20,
      total: 142,
      totalPages: 8,
    });
  });

  // P10
  it('returns totalPages 0 for 0 total items', () => {
    const meta = buildPaginationMeta(1, 20, 0);
    expect(meta.totalPages).toBe(0);
  });

  // P11
  it('handles exact multiples correctly', () => {
    const meta = buildPaginationMeta(1, 20, 100);
    expect(meta.totalPages).toBe(5);
  });
});

describe('calculateSkip', () => {
  // P12
  it('returns correct offset for page 3, limit 20', () => {
    expect(calculateSkip(3, 20)).toBe(40);
  });

  // P13
  it('returns 0 for page 1', () => {
    expect(calculateSkip(1, 20)).toBe(0);
  });
});
