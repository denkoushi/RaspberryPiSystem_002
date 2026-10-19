import { prisma } from '../../lib/prisma.js';

import type { Prisma } from '@prisma/client';

const TRAINING_TRANSACTION_OPTIONS = Object.freeze({ maxWait: 15_000, timeout: 30_000 });

export function runTrainingTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(work, TRAINING_TRANSACTION_OPTIONS);
}
