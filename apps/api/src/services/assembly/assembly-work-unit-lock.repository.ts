import { Prisma } from '@prisma/client';

import type { AssemblyTransactionClient } from './assembly-work-session-lock.repository.js';

/** WorkUnitをID昇順でロックし、組立ライフサイクル変更のロック順を統一する。 */
export async function lockAssemblyWorkUnits(
  tx: AssemblyTransactionClient,
  ids: string[]
): Promise<void> {
  const distinctIds = [...new Set(ids)].sort();
  if (distinctIds.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "AssemblySerialRegistry" WHERE "id" IN (${Prisma.join(distinctIds)}) ORDER BY "id" FOR UPDATE`
  );
}
