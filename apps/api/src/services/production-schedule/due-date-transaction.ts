import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const DUE_DATE_TRANSACTION_OPTIONS = { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000 } as const;

export function isRetryableDueDateTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;
  const meta = error.meta as { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;
  const sqlState = meta?.driverAdapterError?.cause?.originalCode ?? meta?.code;
  return sqlState === '40001' || sqlState === '40P01';
}

export async function runDueDateTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, DUE_DATE_TRANSACTION_OPTIONS);
    } catch (error) {
      if (!isRetryableDueDateTransactionError(error)) throw error;
      if (attempt === 2) {
        throw new ApiError(409, '他の端末で同時に更新されました。もう一度お試しください');
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}
