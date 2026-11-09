import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

function hashParentRowIdForAdvisoryLock(parentCsvDashboardRowId: string): bigint {
  const digest = createHash('sha256').update(parentCsvDashboardRowId).digest();
  return digest.readBigInt64BE(0);
}

/** 親行単位の order 更新を直列化する transaction-scoped advisory lock。 */
export async function acquireProductionScheduleParentRowLockInTransaction(
  tx: Prisma.TransactionClient,
  parentCsvDashboardRowId: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hashParentRowIdForAdvisoryLock(parentCsvDashboardRowId)})`;
}

/** Acquire the same advisory locks in the caller's row order with one round trip. */
export async function acquireProductionScheduleParentRowLocksInTransaction(
  tx: Prisma.TransactionClient,
  parentCsvDashboardRowIds: string[]
): Promise<void> {
  if (!parentCsvDashboardRowIds.length) return;
  const lockIds = parentCsvDashboardRowIds.map(hashParentRowIdForAdvisoryLock);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(lock_id)
    FROM unnest(${lockIds}::bigint[]) WITH ORDINALITY AS locks(lock_id, position) ORDER BY position`;
}
