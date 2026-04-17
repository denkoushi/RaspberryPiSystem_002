/**
 * FHINMEI_MH_SH Gmail CSV → `ProductionScheduleSeibanMachineNameSupplement` 同期。
 * 対象は「今回の ingest run で追加された行のみ」。その行群を createdAt/id 昇順で走査し、
 * 同一 FSEIBAN は **後勝ち**（同一CSV内の末尾行に相当）。
 */
import { type Prisma, type PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from './constants.js';

const CREATE_MANY_CHUNK_SIZE = 200;
const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;

export type SeibanMachineNameSupplementSyncResult = {
  scanned: number;
  normalized: number;
  upserted: number;
  pruned: number;
};

type IngestRunWindow = {
  startedAt: Date;
  completedAt: Date;
  rowsAdded: number;
};

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

export type SeibanMachineNamePair = {
  fseiban: string;
  machineName: string;
};

/**
 * `CsvDashboardRow` を id 昇順で渡し、FSEIBAN ごとに最後の行の機種名を採用する。
 */
export function buildLastWinsSeibanMachineNames(
  orderedRows: Array<{ rowData: Record<string, unknown> }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const { rowData } of orderedRows) {
    const fseiban = normalizeToken(rowData.FSEIBAN);
    if (fseiban.length === 0) continue;
    const machineName = normalizeToken(rowData.FHINMEI_MH_SH);
    map.set(fseiban, machineName);
  }
  return map;
}

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
    throw new Error(`[SeibanMachineNameSupplementSync] ingest run not found: ${ingestRunId}`);
  }
  if (ingestRun.csvDashboardId !== PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID) {
    throw new Error(
      `[SeibanMachineNameSupplementSync] ingest run dashboard mismatch: expected ${PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID}, got ${ingestRun.csvDashboardId}`
    );
  }
  if (!ingestRun.completedAt) {
    throw new Error(`[SeibanMachineNameSupplementSync] ingest run is not completed yet: ${ingestRunId}`);
  }

  return {
    startedAt: ingestRun.startedAt,
    completedAt: ingestRun.completedAt,
    rowsAdded: ingestRun.rowsAdded,
  };
}

export function mapToCreateInputs(
  lastWins: Map<string, string>,
  sourceCsvDashboardId: string
): Prisma.ProductionScheduleSeibanMachineNameSupplementCreateManyInput[] {
  const inputs: Prisma.ProductionScheduleSeibanMachineNameSupplementCreateManyInput[] = [];
  for (const [fseiban, machineName] of lastWins) {
    if (machineName.length === 0) continue;
    inputs.push({
      sourceCsvDashboardId,
      fseiban,
      machineName,
    });
  }
  return inputs;
}

export async function loadSeibanMachineNameSupplementSourceRows(
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
      csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
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
      `[SeibanMachineNameSupplementSync] ingest run row count mismatch: expected ${ingestRun.rowsAdded}, got ${rows.length}`
    );
  }

  const orderedRows = rows.map((r) => ({
    rowData: r.rowData as Record<string, unknown>,
  }));

  return { scanned: rows.length, orderedRows };
}

export async function runSeibanMachineNameSupplementReplacementTransaction(
  client: PrismaClient,
  params: {
    scanned: number;
    createInputs: Prisma.ProductionScheduleSeibanMachineNameSupplementCreateManyInput[];
  }
): Promise<SeibanMachineNameSupplementSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleSeibanMachineNameSupplement.deleteMany({
        where: { sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
      });

      let inserted = 0;
      for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
        const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const batch = await tx.productionScheduleSeibanMachineNameSupplement.createMany({ data: chunk });
        inserted += batch.count;
      }

      if (inserted !== params.createInputs.length) {
        throw new Error(
          `[SeibanMachineNameSupplementSync] insert count mismatch: expected ${params.createInputs.length}, got ${inserted}`
        );
      }

      return {
        scanned: params.scanned,
        normalized: params.createInputs.length,
        upserted: inserted,
        pruned: pruneResult.count,
      };
    },
    {
      maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
      timeout: REPLACEMENT_TX_TIMEOUT_MS,
    }
  );
}

export async function runSeibanMachineNameSupplementClearTransaction(
  client: PrismaClient,
  scanned: number
): Promise<SeibanMachineNameSupplementSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleSeibanMachineNameSupplement.deleteMany({
        where: { sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
      });
      return {
        scanned,
        normalized: 0,
        upserted: 0,
        pruned: pruneResult.count,
      };
    },
    {
      maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
      timeout: REPLACEMENT_TX_TIMEOUT_MS,
    }
  );
}
