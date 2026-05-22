import type { PrismaClient } from '@prisma/client';

import { RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID } from '../constants.js';

export type RiggingInspectionSyncResult = {
  csvRowsScanned: number;
  created: number;
  deduped: number;
  unmatchedGear: number;
  unmatchedEmployee: number;
  invalidResult: number;
  invalidDate: number;
};

type IngestRunWindow = {
  startedAt: Date;
  completedAt: Date;
  rowsAdded: number;
};

async function loadIngestRunWindow(client: PrismaClient, ingestRunId: string): Promise<IngestRunWindow> {
  const ingestRun = await client.csvDashboardIngestRun.findUnique({
    where: { id: ingestRunId },
    select: {
      csvDashboardId: true,
      startedAt: true,
      completedAt: true,
      rowsAdded: true,
    },
  });

  if (!ingestRun) {
    throw new Error(`[RiggingInspectionSync] ingest run not found: ${ingestRunId}`);
  }
  if (ingestRun.csvDashboardId !== RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID) {
    throw new Error(
      `[RiggingInspectionSync] ingest run dashboard mismatch: expected ${RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID}, got ${ingestRun.csvDashboardId}`
    );
  }
  if (!ingestRun.completedAt) {
    throw new Error(`[RiggingInspectionSync] ingest run is not completed yet: ${ingestRunId}`);
  }

  return {
    startedAt: ingestRun.startedAt,
    completedAt: ingestRun.completedAt,
    rowsAdded: ingestRun.rowsAdded,
  };
}

export async function loadRiggingInspectionSourceRowsFromIngest(
  client: PrismaClient,
  ingestRunId: string
): Promise<{
  scanned: number;
  orderedRows: Array<{ rowData: Record<string, unknown> }>;
}> {
  const ingestRun = await loadIngestRunWindow(client, ingestRunId);
  if (ingestRun.rowsAdded === 0) {
    return { scanned: 0, orderedRows: [] };
  }

  const rows = await client.csvDashboardRow.findMany({
    where: {
      csvDashboardId: RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID,
      createdAt: {
        gte: ingestRun.startedAt,
        lte: ingestRun.completedAt,
      },
    },
    select: { rowData: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  if (rows.length !== ingestRun.rowsAdded) {
    throw new Error(
      `[RiggingInspectionSync] ingest run row count mismatch: expected ${ingestRun.rowsAdded}, got ${rows.length}`
    );
  }

  return {
    scanned: rows.length,
    orderedRows: rows.map((r) => ({ rowData: r.rowData as Record<string, unknown> })),
  };
}

export function emptyRiggingInspectionSyncResult(scanned = 0): RiggingInspectionSyncResult {
  return {
    csvRowsScanned: scanned,
    created: 0,
    deduped: 0,
    unmatchedGear: 0,
    unmatchedEmployee: 0,
    invalidResult: 0,
    invalidDate: 0,
  };
}

export async function loadRiggingInspectionSourceRowsFromDashboard(
  client: PrismaClient
): Promise<{
  scanned: number;
  orderedRows: Array<{ rowData: Record<string, unknown> }>;
}> {
  const rows = await client.csvDashboardRow.findMany({
    where: {
      csvDashboardId: RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID,
    },
    select: { rowData: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return {
    scanned: rows.length,
    orderedRows: rows.map((r) => ({ rowData: r.rowData as Record<string, unknown> })),
  };
}
