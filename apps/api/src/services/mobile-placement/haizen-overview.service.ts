import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../production-schedule/seiban-machine-display-names.service.js';

import { filterActivePlacements } from './placement-completion.service.js';
import { readScheduleDates } from './schedule-dates.js';

import type { Prisma } from '@prisma/client';

export const HAIZEN_OVERVIEW_LIMIT = 3000;

function snapshotText(snapshot: Prisma.JsonValue | null, field: string): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const value = snapshot[field];
  return typeof value === 'string' ? value.trim() || null : null;
}

/** Current placements from Android branches and Zero2W order-only scans. */
export async function listHaizenOverview() {
  const [branches, zero2w] = await Promise.all([prisma.orderPlacementBranchState.findMany({
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true, slipKind: true, manufacturingOrderBarcodeRaw: true, branchNo: true,
      shelfCodeRaw: true, scheduleSnapshot: true, updatedAt: true
    }
  }), prisma.haizenCurrentPlacement.findMany({
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true, manufacturingOrderBarcodeRaw: true,
      shelfCodeRaw: true, scheduleSnapshot: true, updatedAt: true
    }
  })]);
  const placements = (await filterActivePlacements([
    ...branches.map(row => ({ ...row, source: 'branch' as const })),
    ...zero2w.map(row => ({ ...row, source: 'zero2w' as const, branchNo: null, slipKind: undefined }))
  ])).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
  const rows = placements.slice(0, HAIZEN_OVERVIEW_LIMIT).map(({ scheduleSnapshot, updatedAt, id, source, branchNo, shelfCodeRaw, manufacturingOrderBarcodeRaw }) => ({
    id, source, branchNo, shelfCodeRaw, manufacturingOrderBarcodeRaw,
    fseiban: snapshotText(scheduleSnapshot, 'FSEIBAN'),
    fhincd: snapshotText(scheduleSnapshot, 'FHINCD'),
    fhinmei: snapshotText(scheduleSnapshot, 'FHINMEI'),
    updatedAt: updatedAt.toISOString()
  }));
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched(rows.flatMap(row => row.fseiban ? [row.fseiban] : []));
  const seibans = [...new Set(rows.flatMap(row => row.fseiban ? [row.fseiban] : []))];
  const schedules = seibans.length ? await prisma.$queryRaw<{ fseiban: string; partsCompleteDate: Date | null; surfaceSendOutDates: Prisma.JsonValue }[]>`
    SELECT "fseiban", "partsCompleteDate", "surfaceSendOutDates"
    FROM "ProductionScheduleDScheduleMinutes"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "fseiban" = ANY(${seibans}::text[])
  ` : [];
  const dates = new Map(schedules.map(row => [row.fseiban, readScheduleDates(row)]));
  return {
    rows: rows.map(row => ({ ...row, machineName: row.fseiban ? machineNames[row.fseiban] ?? null : null,
      dueDate: (row.fseiban ? dates.get(row.fseiban)?.partsCompleteDate : null) ?? null,
      sendOutDate: (row.fseiban ? dates.get(row.fseiban)?.sendOutDate : null) ?? null })),
    truncated: placements.length > HAIZEN_OVERVIEW_LIMIT
  };
}
