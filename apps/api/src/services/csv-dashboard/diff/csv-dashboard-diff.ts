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

const isCompleted = (rowData: Prisma.JsonValue, completedValue: string): boolean => {
  const progress = (rowData as Record<string, unknown> | null | undefined)?.progress;
  return typeof progress === 'string' && progress.trim() === completedValue;
};

export function computeCsvDashboardDedupDiff(params: {
  dashboardId: string;
  incomingRows: IncomingRow[];
  existingRows: ExistingRow[];
  completedValue: string;
}): DiffResult {
  const { dashboardId, incomingRows, existingRows, completedValue } = params;
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

    if (isCompleted(existing.rowData, completedValue)) {
      rowsSkipped++;
      continue;
    }

    const existingRowData = existing.rowData as unknown as NormalizedRowData;
    const sameData = JSON.stringify(existingRowData) === JSON.stringify(incoming.data);
    const sameOccurredAt = existing.occurredAt.getTime() === incoming.occurredAt.getTime();
    if (sameData && sameOccurredAt) {
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
