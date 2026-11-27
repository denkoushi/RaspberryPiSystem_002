import type { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { acquireProductionScheduleParentRowLocksInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';

/** Lock parent rows in sorted order (advisory, then FOR UPDATE); 409 when any row has vanished. */
export async function lockPlanningSourceRows(client: Prisma.TransactionClient, sortedRowIds: readonly string[]): Promise<void> {
  if (!sortedRowIds.length) return;
  const ids = [...sortedRowIds];
  await acquireProductionScheduleParentRowLocksInTransaction(client, ids);
  const locked = await client.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CsvDashboardRow" WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
  const lockedIds = new Set(locked.map((row) => row.id));
  if (ids.some((id) => !lockedIds.has(id))) throw new ApiError(409, '元行が消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
}
