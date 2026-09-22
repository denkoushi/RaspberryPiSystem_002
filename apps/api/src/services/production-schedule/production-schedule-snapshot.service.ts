import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { extractOutsideDimensionsDisplay } from './production-schedule-snapshot-fields.js';

/** Historical snapshot values, preserved without string normalization. rowId is CsvDashboardRow.id. */
export type ProductionSchedulePlacementSnapshot = {
  rowId: string;
  manufacturingOrderNo: Prisma.JsonValue;
  seiban: Prisma.JsonValue;
  partCode: Prisma.JsonValue;
  partName: Prisma.JsonValue;
};

export type ProductionSchedulePalletSnapshot = ProductionSchedulePlacementSnapshot & {
  resourceCode: Prisma.JsonValue;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  outsideDimensionsDisplay: string | null;
};

function toPlacementSnapshot(row: { id: string; rowData: Prisma.JsonValue }): ProductionSchedulePlacementSnapshot {
  const fields = (row.rowData ?? {}) as Record<string, Prisma.JsonValue | undefined>;
  return {
    rowId: row.id,
    manufacturingOrderNo: fields.ProductNo ?? null,
    seiban: fields.FSEIBAN ?? null,
    partCode: fields.FHINCD ?? null,
    partName: fields.FHINMEI ?? null,
  };
}

/** Read an already selected row. Missing rows return null; database errors propagate to the caller. */
export async function findProductionSchedulePlacementSnapshot(
  rowId: string
): Promise<ProductionSchedulePlacementSnapshot | null> {
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId },
    select: { id: true, rowData: true },
  });
  return row ? toPlacementSnapshot(row) : null;
}

/** Preserve the existing pallet projection, including dashboard scope on supplements only. */
export async function findProductionSchedulePalletSnapshot(
  rowId: string
): Promise<ProductionSchedulePalletSnapshot | null> {
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId },
    select: {
      id: true,
      rowData: true,
      orderSupplements: {
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
        take: 1,
        select: { plannedQuantity: true, plannedStartDate: true },
      },
    },
  });
  if (!row) return null;

  const fields = (row.rowData ?? {}) as Record<string, Prisma.JsonValue | undefined>;
  const supplement = row.orderSupplements[0];
  return {
    ...toPlacementSnapshot(row),
    resourceCode: fields.FSIGENCD ?? null,
    plannedQuantity: supplement?.plannedQuantity ?? null,
    plannedStartDate: supplement?.plannedStartDate ?? null,
    outsideDimensionsDisplay: extractOutsideDimensionsDisplay(fields),
  };
}
