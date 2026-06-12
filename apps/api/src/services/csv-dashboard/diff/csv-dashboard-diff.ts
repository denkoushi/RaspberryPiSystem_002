import { Prisma } from '@prisma/client';
import type { NormalizedRowData } from '../csv-dashboard.types.js';
import { resolveUpdatedAt } from './csv-dashboard-updated-at.js';
import { parseFkojunstStatusMailFupdteDt } from '../fkojunst-status-mail-fupdtedt-parse.js';

type IncomingRow = {
  data: NormalizedRowData;
  occurredAt: Date;
  sourceIngestRunId?: string | null;
  sourceRowOrdinal?: number | null;
  sourceIngestRunStartedAt?: Date | null;
  hash?: string;
};

type ExistingRow = {
  id: string;
  dataHash: string | null;
  occurredAt: Date;
  rowData: Prisma.JsonValue;
  createdAt?: Date | null;
  sourceIngestRunId?: string | null;
  sourceIngestRun?: {
    status?: string | null;
    completedAt?: Date | null;
  } | null;
};

type CreateRow = {
  csvDashboardId: string;
  occurredAt: Date;
  dataHash: string;
  rowData: Prisma.InputJsonValue;
  sourceIngestRunId?: string | null;
  sourceRowOrdinal?: number | null;
  sourceIngestRunStartedAt?: Date | null;
};

type UpdateRow = {
  id: string;
  occurredAt: Date;
  rowData: Prisma.InputJsonValue;
  sourceIngestRunId?: string | null;
  sourceRowOrdinal?: number | null;
  sourceIngestRunStartedAt?: Date | null;
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
  firstIncomingHashWins?: boolean;
  refreshSourceMetadataOnDuplicate?: boolean;
  preferLaterUnparseableDuplicate?: boolean;
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
  const firstIncomingHashWins = options?.firstIncomingHashWins === true;
  const refreshSourceMetadataOnDuplicate = options?.refreshSourceMetadataOnDuplicate === true;
  const preferLaterUnparseableDuplicate = options?.preferLaterUnparseableDuplicate === true;
  const incomingByHash = new Map<
    string,
    {
      occurredAt: Date;
      data: NormalizedRowData;
      sourceIngestRunId?: string | null;
      sourceRowOrdinal?: number | null;
      sourceIngestRunStartedAt?: Date | null;
    }
  >();
  let rowsAdded = 0;
  let rowsSkipped = 0;

  const hasUnparseableFupdtedt = (row: NormalizedRowData): boolean =>
    Object.prototype.hasOwnProperty.call(row, 'FUPDTEDT') &&
    parseFkojunstStatusMailFupdteDt((row as Record<string, unknown>).FUPDTEDT) === null;

  const shouldReplaceIncomingDuplicate = (
    current: { data: NormalizedRowData; sourceRowOrdinal?: number | null },
    next: IncomingRow
  ): boolean => {
    if (!preferLaterUnparseableDuplicate) {
      return false;
    }
    if (!hasUnparseableFupdtedt(current.data) && !hasUnparseableFupdtedt(next.data)) {
      return false;
    }
    if (current.sourceRowOrdinal == null || next.sourceRowOrdinal == null) {
      return false;
    }
    return next.sourceRowOrdinal > current.sourceRowOrdinal;
  };

  for (const row of incomingRows) {
    if (!row.hash) {
      rowsSkipped++;
      continue;
    }
    const current = incomingByHash.get(row.hash);
    if (firstIncomingHashWins && current != null) {
      if (shouldReplaceIncomingDuplicate(current, row)) {
        incomingByHash.set(row.hash, {
          occurredAt: row.occurredAt,
          data: row.data,
          sourceIngestRunId: row.sourceIngestRunId,
          sourceRowOrdinal: row.sourceRowOrdinal,
          sourceIngestRunStartedAt: row.sourceIngestRunStartedAt
        });
      }
      rowsSkipped++;
      continue;
    }
    incomingByHash.set(row.hash, {
      occurredAt: row.occurredAt,
      data: row.data,
      sourceIngestRunId: row.sourceIngestRunId,
      sourceRowOrdinal: row.sourceRowOrdinal,
      sourceIngestRunStartedAt: row.sourceIngestRunStartedAt
    });
  }

  const isReaderVisibleExistingRow = (row: ExistingRow): boolean =>
    row.sourceIngestRunId == null ||
    (row.sourceIngestRun?.status === 'COMPLETED' && row.sourceIngestRun.completedAt != null);

  const shouldReplaceExistingCandidate = (current: ExistingRow, next: ExistingRow): boolean => {
    const currentVisible = isReaderVisibleExistingRow(current);
    const nextVisible = isReaderVisibleExistingRow(next);
    if (currentVisible !== nextVisible) {
      return nextVisible;
    }
    const currentCreatedAt = current.createdAt?.getTime() ?? 0;
    const nextCreatedAt = next.createdAt?.getTime() ?? 0;
    if (currentCreatedAt !== nextCreatedAt) {
      return nextCreatedAt > currentCreatedAt;
    }
    return next.id > current.id;
  };

  const existingByHash = new Map<string, ExistingRow>();
  for (const existing of existingRows) {
    if (existing.dataHash) {
      const current = existingByHash.get(existing.dataHash);
      if (current == null || shouldReplaceExistingCandidate(current, existing)) {
        existingByHash.set(existing.dataHash, existing);
      }
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
        rowData: incoming.data as Prisma.InputJsonValue,
        sourceIngestRunId: incoming.sourceIngestRunId,
        sourceRowOrdinal: incoming.sourceRowOrdinal,
        sourceIngestRunStartedAt: incoming.sourceIngestRunStartedAt
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
            rowData: incoming.data as Prisma.InputJsonValue,
            sourceIngestRunId: incoming.sourceIngestRunId,
            sourceRowOrdinal: incoming.sourceRowOrdinal,
            sourceIngestRunStartedAt: incoming.sourceIngestRunStartedAt
          });
          rowsAdded++;
          continue;
        }
      }
    }

    const incomingUpdatedAt = resolveUpdatedAt(incoming.data as Prisma.JsonValue, incoming.occurredAt);
    const existingUpdatedAt = resolveUpdatedAt(existing.rowData, existing.occurredAt);
    if (incomingUpdatedAt.getTime() <= existingUpdatedAt.getTime()) {
      if (refreshSourceMetadataOnDuplicate) {
        updates.push({
          id: existing.id,
          occurredAt: incoming.occurredAt,
          rowData: incoming.data as Prisma.InputJsonValue,
          sourceIngestRunId: incoming.sourceIngestRunId,
          sourceRowOrdinal: incoming.sourceRowOrdinal,
          sourceIngestRunStartedAt: incoming.sourceIngestRunStartedAt
        });
      }
      rowsSkipped++;
      continue;
    }

    updates.push({
      id: existing.id,
      occurredAt: incoming.occurredAt,
      rowData: incoming.data as Prisma.InputJsonValue,
      sourceIngestRunId: incoming.sourceIngestRunId,
      sourceRowOrdinal: incoming.sourceRowOrdinal,
      sourceIngestRunStartedAt: incoming.sourceIngestRunStartedAt
    });
    rowsAdded++;
  }

  return { rowsToCreate, updates, rowsAdded, rowsSkipped };
}
