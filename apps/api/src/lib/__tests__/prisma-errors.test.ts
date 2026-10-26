import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors.js';
import { isPrismaNotFoundError, throwIfPrismaNotFound } from '../prisma-errors.js';

describe('isPrismaNotFoundError', () => {
  it('returns true for a Prisma P2025 error', () => {
    const error = new PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'test' });

    expect(isPrismaNotFoundError(error)).toBe(true);
  });

  it('returns false for other Prisma codes', () => {
    const error = new PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'test' });

    expect(isPrismaNotFoundError(error)).toBe(false);
  });

  it('returns false for non-Prisma errors, including P2025 lookalikes', () => {
    for (const error of [new Error('x'), { code: 'P2025' }, null, undefined, 'P2025']) {
      expect(isPrismaNotFoundError(error)).toBe(false);
    }
  });
});

describe('throwIfPrismaNotFound', () => {
  it('throws an ApiError with status 404 and the supplied message for P2025', () => {
    const error = new PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'test' });

    expect(() => throwIfPrismaNotFound(error, '対象が見つかりません')).toThrowError(
      expect.objectContaining({
        constructor: ApiError,
        statusCode: 404,
        message: '対象が見つかりません',
        code: undefined,
        details: undefined
      })
    );
  });

  it('returns without throwing for other Prisma codes', () => {
    const error = new PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'test' });

    expect(throwIfPrismaNotFound(error, '対象が見つかりません')).toBeUndefined();
  });

  it('returns without throwing for non-Prisma errors, including P2025 lookalikes', () => {
    for (const error of [new Error('x'), { code: 'P2025' }, null, undefined, 'P2025']) {
      expect(throwIfPrismaNotFound(error, '対象が見つかりません')).toBeUndefined();
    }
  });
});
