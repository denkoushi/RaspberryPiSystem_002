import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

function hashParentRowIdForAdvisoryLock(parentCsvDashboardRowId: string): bigint {
  const digest = createHash('sha256').update(parentCsvDashboardRowId).digest();
  return digest.readBigInt64BE(0);
}

/** 親行単位の split / 親 order 更新を直列化する transaction-scoped advisory lock。 */
export async function acquireProductionScheduleParentRowLockInTransaction(
  tx: Prisma.TransactionClient,
  parentCsvDashboardRowId: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hashParentRowIdForAdvisoryLock(parentCsvDashboardRowId)})`;
}
