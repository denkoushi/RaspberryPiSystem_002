import type { Prisma, PrismaClient } from '@prisma/client';

// Pi5 aggregates can approach Prisma's default 5s interactive-transaction timeout even without JIT.
const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

export type JitControlledClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw'> & Partial<Pick<PrismaClient, '$transaction'>>;
export type JitControlledQueryClient = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

/**
 * The load aggregate's estimated cost triggers PostgreSQL 18 JIT compilation that costs more
 * than the query itself (KB-418, KB-452). SET LOCAL must share the query's connection and ends
 * with the transaction; a root client gets its own short transaction.
 */
export async function readWithoutJit<T>(client: JitControlledClient, read: (tx: JitControlledQueryClient) => Promise<T>): Promise<T> {
  const run = async (tx: JitControlledQueryClient) => {
    await tx.$executeRaw`SET LOCAL jit = off`;
    return read(tx);
  };
  return client.$transaction
    ? client.$transaction(run, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS })
    : run(client);
}
