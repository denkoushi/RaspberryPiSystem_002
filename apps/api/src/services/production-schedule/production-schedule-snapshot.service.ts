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

export type ProductionSchedulePlacementBarcodeSnapshot = Pick<
  ProductionSchedulePlacementSnapshot,
  'manufacturingOrderNo' | 'seiban' | 'partCode' | 'partName'
> & {
  barcodeMatchValues: string[];
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

function toPlacementBarcodeSnapshot(rowData: Prisma.JsonValue): ProductionSchedulePlacementBarcodeSnapshot {
  const fields = (rowData ?? {}) as Record<string, Prisma.JsonValue | undefined>;
  const barcodeMatchValues = [fields.ProductNo, fields.FSEIBAN, fields.FHINCD].flatMap((value) => {
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  });

  return {
    manufacturingOrderNo: fields.ProductNo ?? null,
    seiban: fields.FSEIBAN ?? null,
    partCode: fields.FHINCD ?? null,
    partName: fields.FHINMEI ?? null,
    barcodeMatchValues,
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

/** Read a selected placement barcode row within the production schedule dashboard. */
export async function findProductionSchedulePlacementBarcodeSnapshot(
  rowId: string
): Promise<ProductionSchedulePlacementBarcodeSnapshot | null> {
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { rowData: true },
  });
  return row ? toPlacementBarcodeSnapshot(row.rowData) : null;
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

export type ProductionSchedulePalletDisplaySnapshot = {
  rowId: string;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  outsideDimensionsDisplay: string | null;
};

/** Batch fallback for pallet lists. Unlike registration, supplements are not dashboard-filtered. */
export async function listProductionSchedulePalletDisplaySnapshots(
  rowIds: string[]
): Promise<ProductionSchedulePalletDisplaySnapshot[]> {
  if (rowIds.length === 0) return [];

  const rows = await prisma.csvDashboardRow.findMany({
    where: { id: { in: rowIds } },
    select: {
      id: true,
      rowData: true,
      orderSupplements: {
        take: 1,
        select: { plannedQuantity: true, plannedStartDate: true },
      },
    },
  });
  return rows.map((row) => {
    const rowData = (row.rowData ?? null) as Record<string, unknown> | null;
    const supplement = row.orderSupplements[0];
    return {
      rowId: row.id,
      plannedQuantity: supplement?.plannedQuantity ?? null,
      plannedStartDate: supplement?.plannedStartDate ?? null,
      outsideDimensionsDisplay: rowData ? extractOutsideDimensionsDisplay(rowData) : null,
    };
  });
}
