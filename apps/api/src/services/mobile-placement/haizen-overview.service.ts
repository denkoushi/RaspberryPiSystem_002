import { prisma } from '../../lib/prisma.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../production-schedule/seiban-machine-display-names.service.js';

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
    take: HAIZEN_OVERVIEW_LIMIT + 1,
    select: {
      id: true, manufacturingOrderBarcodeRaw: true, branchNo: true,
      shelfCodeRaw: true, scheduleSnapshot: true, updatedAt: true
    }
  }), prisma.haizenCurrentPlacement.findMany({
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: HAIZEN_OVERVIEW_LIMIT + 1,
    select: {
      id: true, manufacturingOrderBarcodeRaw: true,
      shelfCodeRaw: true, scheduleSnapshot: true, updatedAt: true
    }
  })]);
  const placements = [
    ...branches.map(row => ({ ...row, source: 'branch' as const })),
    ...zero2w.map(row => ({ ...row, source: 'zero2w' as const, branchNo: null }))
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
  const rows = placements.slice(0, HAIZEN_OVERVIEW_LIMIT).map(({ scheduleSnapshot, updatedAt, ...placement }) => ({
    ...placement,
    fseiban: snapshotText(scheduleSnapshot, 'FSEIBAN'),
    fhincd: snapshotText(scheduleSnapshot, 'FHINCD'),
    fhinmei: snapshotText(scheduleSnapshot, 'FHINMEI'),
    updatedAt: updatedAt.toISOString()
  }));
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched(rows.flatMap(row => row.fseiban ? [row.fseiban] : []));
  return {
    rows: rows.map(row => ({ ...row, machineName: row.fseiban ? machineNames[row.fseiban] ?? null : null })),
    truncated: placements.length > HAIZEN_OVERVIEW_LIMIT
  };
}
