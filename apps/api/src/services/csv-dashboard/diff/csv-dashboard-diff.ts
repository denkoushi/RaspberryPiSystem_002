import { Prisma } from '@prisma/client';
import type { NormalizedRowData } from '../csv-dashboard.types.js';

type IncomingRow = {
  data: NormalizedRowData;
  occurredAt: Date;
  hash?: string;
};

type ExistingRow = {
  id: string;
  dataHash: string | null;
  occurredAt: Date;
  rowData: Prisma.JsonValue;
};

type CreateRow = {
  csvDashboardId: string;
  occurredAt: Date;
  dataHash: string;
  rowData: Prisma.InputJsonValue;
};

type UpdateRow = {
  id: string;
  occurredAt: Date;
  rowData: Prisma.InputJsonValue;
};

type DiffResult = {
  rowsToCreate: CreateRow[];
  updates: UpdateRow[];
  rowsAdded: number;
  rowsSkipped: number;
};

type MaxProductNoDiffOptions = {
  maxProductNoWins?: boolean;
  productNoColumn?: string;
};

const parseJstDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const dateTimeMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
  if (!dateTimeMatch) {
    return null;
  }
  const [, year, month, day, hour = '0', minute = '0'] = dateTimeMatch;
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10) - 1;
  const dayNum = parseInt(day, 10);
  const hourNum = parseInt(hour, 10);
  const minuteNum = parseInt(minute, 10);
  const localDate = new Date(yearNum, monthNum, dayNum, hourNum, minuteNum, 0, 0);
  if (isNaN(localDate.getTime())) {
    return null;
  }
  return new Date(localDate.getTime() - 9 * 60 * 60 * 1000);
};

const resolveUpdatedAt = (rowData: Prisma.JsonValue, fallback: Date): Date => {
  const updatedAt = (rowData as Record<string, unknown> | null | undefined)?.updatedAt;
  return parseJstDate(updatedAt) ?? fallback;
};

const resolveProductNo = (rowData: Prisma.JsonValue, productNoColumn: string): bigint | null => {
  const value = (rowData as Record<string, unknown> | null | undefined)?.[productNoColumn];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
};

export function computeCsvDashboardDedupDiff(params: {
  dashboardId: string;
  incomingRows: IncomingRow[];
  existingRows: ExistingRow[];
  completedValue: string;
  options?: MaxProductNoDiffOptions;
}): DiffResult {
  const { dashboardId, incomingRows, existingRows, options } = params;
  const productNoColumn = options?.productNoColumn ?? 'ProductNo';
  const maxProductNoWins = options?.maxProductNoWins === true;
  const incomingByHash = new Map<string, { occurredAt: Date; data: NormalizedRowData }>();
  let rowsAdded = 0;
  let rowsSkipped = 0;

  for (const row of incomingRows) {
    if (!row.hash) {
      rowsSkipped++;
      continue;
    }
    incomingByHash.set(row.hash, { occurredAt: row.occurredAt, data: row.data });
  }

  const existingByHash = new Map<string, { id: string; occurredAt: Date; rowData: Prisma.JsonValue }>();
  for (const existing of existingRows) {
    if (existing.dataHash) {
      existingByHash.set(existing.dataHash, {
        id: existing.id,
        occurredAt: existing.occurredAt,
        rowData: existing.rowData
      });
    }
  }

  const rowsToCreate: CreateRow[] = [];
  const updates: UpdateRow[] = [];

  for (const [hash, incoming] of incomingByHash.entries()) {
    const existing = existingByHash.get(hash);
    if (!existing) {
      rowsToCreate.push({
        csvDashboardId: dashboardId,
        occurredAt: incoming.occurredAt,
        dataHash: hash,
        rowData: incoming.data as Prisma.InputJsonValue
      });
      rowsAdded++;
      continue;
    }

    if (maxProductNoWins) {
      const incomingProductNo = resolveProductNo(incoming.data as Prisma.JsonValue, productNoColumn);
      const existingProductNo = resolveProductNo(existing.rowData, productNoColumn);
      if (incomingProductNo !== null && existingProductNo !== null) {
        if (incomingProductNo < existingProductNo) {
          rowsSkipped++;
          continue;
        }
        if (incomingProductNo > existingProductNo) {
          updates.push({
            id: existing.id,
            occurredAt: incoming.occurredAt,
            rowData: incoming.data as Prisma.InputJsonValue
          });
          rowsAdded++;
          continue;
        }
      }
    }

    const incomingUpdatedAt = resolveUpdatedAt(incoming.data as Prisma.JsonValue, incoming.occurredAt);
    const existingUpdatedAt = resolveUpdatedAt(existing.rowData, existing.occurredAt);
    if (incomingUpdatedAt.getTime() <= existingUpdatedAt.getTime()) {
      rowsSkipped++;
      continue;
    }

    updates.push({
      id: existing.id,
      occurredAt: incoming.occurredAt,
      rowData: incoming.data as Prisma.InputJsonValue
    });
    rowsAdded++;
  }

  return { rowsToCreate, updates, rowsAdded, rowsSkipped };
}
