import { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';

export const SELF_INSPECTION_OPERATOR_ENTRY_LOCKED_BY_INSPECTOR =
  'SELF_INSPECTION_OPERATOR_ENTRY_LOCKED_BY_INSPECTOR';

export async function assertOperatorEntryNotLockedByInspector(
  db: Prisma.TransactionClient,
  sessionId: string,
  entryIndex: number
): Promise<void> {
  const inspectorEntry = await db.selfInspectionInspectorEntry.findUnique({
    where: { sessionId_entryIndex: { sessionId, entryIndex } },
    select: { id: true }
  });
  if (!inspectorEntry) return;
  throw new ApiError(
    409,
    `入力件 ${entryIndex + 1} は検査員測定が開始済みのため作業者測定値を変更できません`,
    undefined,
    SELF_INSPECTION_OPERATOR_ENTRY_LOCKED_BY_INSPECTOR
  );
}
