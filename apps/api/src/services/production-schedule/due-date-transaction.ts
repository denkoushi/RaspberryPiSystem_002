import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const MAX_TRANSACTION_ATTEMPTS = 6;
const DUE_DATE_TRANSACTION_OPTIONS = { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000 } as const;

export function isRetryableDueDateTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;
  const meta = error.meta as { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;
  const sqlState = meta?.driverAdapterError?.cause?.originalCode ?? meta?.code;
  return sqlState === '40001' || sqlState === '40P01';
}

export async function runDueDateTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isolationLevel?: 'Serializable' | 'ReadCommitted' } = {}
): Promise<T> {
  const transactionOptions = {
    ...DUE_DATE_TRANSACTION_OPTIONS,
    isolationLevel: options.isolationLevel ?? DUE_DATE_TRANSACTION_OPTIONS.isolationLevel
  };
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(work, transactionOptions);
    } catch (error) {
      if (!isRetryableDueDateTransactionError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS - 1) {
        throw new ApiError(409, '他の端末で同時に更新されました。もう一度お試しください');
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1) + Math.floor(Math.random() * 10)));
    }
  }
  throw new Error('unreachable');
}
