import { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardScheduleSource } from '@raspi-system/shared-types';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { listDScheduleMinutesKinds } from '../d-schedule-minutes/kind-membership.js';

/** Unknown/manual registrations remain visible; dual memberships match either source. */
export async function readScheduleSourceExcludedFseibans(
  scheduleSource: GrindingPlanningBoardScheduleSource = 'both',
  fseibans?: string[]
): Promise<string[]> {
  if (scheduleSource === 'both') return [];
  const memberships = await listDScheduleMinutesKinds({ csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseibans });
  const kind = scheduleSource === 'general' ? 'INTERNAL' : 'D_COMPANY';
  return [...memberships].filter(([, kinds]) => kinds.length > 0 && !kinds.includes(kind)).map(([fseiban]) => fseiban).sort();
}

export function withScheduleSourceWhere(baseWhere: Prisma.Sql, excluded: readonly string[]): Prisma.Sql {
  if (!excluded.length) return baseWhere;
  return Prisma.sql`(${baseWhere}) AND COALESCE(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') NOT IN (${Prisma.join(excluded)})`;
}

/** Replace only the requested slots; every other item retains its global position. */
export function mergeScheduleSourceOrder(fullOrder: readonly string[], requestedOrder: readonly string[]): string[] {
  const requested = new Set(requestedOrder);
  let index = 0;
  return fullOrder.map((id) => requested.has(id) ? requestedOrder[index++]! : id);
}
