import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { ApiError } from './errors.js';

export function isPrismaNotFoundError(error: unknown): error is PrismaClientKnownRequestError {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2025';
}

// PrismaのP2025エラー（レコードが見つからない）を404に変換
export function throwIfPrismaNotFound(error: unknown, message: string): void {
  if (isPrismaNotFoundError(error)) {
    throw new ApiError(404, message);
  }
}
