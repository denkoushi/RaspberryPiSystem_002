/**
 * Gmail 件名 CustomerSCAW の CSV を取り込んだ実行について、MH/SH winner 行の FHINMEI と
 * FANKENMEI を正規化照合し `ProductionScheduleFseibanCustomerScaw` を source 単位で全置換する。
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { normalizeCustomerScawMatchKey } from './customer-scaw-normalize.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

const CREATE_MANY_CHUNK_SIZE = 200;
const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;

export type CustomerScawSyncResult = {
  csvRowsScanned: number;
  fankenmeiKeys: number;
  productionRowsScanned: number;
  matchedFseibans: number;
  upserted: number;
  pruned: number;
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
    throw new Error(`[CustomerScawSync] ingest run not found: ${ingestRunId}`);
  }
  if (ingestRun.csvDashboardId !== PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID) {
    throw new Error(
      `[CustomerScawSync] ingest run dashboard mismatch: expected ${PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID}, got ${ingestRun.csvDashboardId}`
    );
  }
  if (!ingestRun.completedAt) {
    throw new Error(`[CustomerScawSync] ingest run is not completed yet: ${ingestRunId}`);
  }

  return {
    startedAt: ingestRun.startedAt,
    completedAt: ingestRun.completedAt,
    rowsAdded: ingestRun.rowsAdded,
  };
}

/**
 * 同一 FANKENMEI（正規化キー）は CSV 走査順で **後勝ち**。同一 Customer 列の重複も同様。
 */
export function buildFankenmeiToCustomerLastWins(
  orderedRows: Array<{ rowData: Record<string, unknown> }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const { rowData } of orderedRows) {
    const fankRaw = rowData.FANKENMEI;
    const custRaw = rowData.Customer;
    const key = normalizeCustomerScawMatchKey(fankRaw);
    const customer = String(custRaw ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (key.length === 0 || customer.length === 0) {
      continue;
    }
    map.set(key, customer);
  }
  return map;
}

export function mapToCreateInputs(
  fseibanToCustomer: Map<string, string>,
  sourceCsvDashboardId: string
): Prisma.ProductionScheduleFseibanCustomerScawCreateManyInput[] {
  const inputs: Prisma.ProductionScheduleFseibanCustomerScawCreateManyInput[] = [];
  for (const [fseiban, customerName] of fseibanToCustomer) {
    if (fseiban.length === 0 || customerName.length === 0) continue;
    inputs.push({
      sourceCsvDashboardId,
      fseiban,
      customerName,
    });
  }
  return inputs;
}

export async function loadCustomerScawSourceRowsFromIngest(
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
      csvDashboardId: PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID,
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
      `[CustomerScawSync] ingest run row count mismatch: expected ${ingestRun.rowsAdded}, got ${rows.length}`
    );
  }

  return {
    scanned: rows.length,
    orderedRows: rows.map((r) => ({ rowData: r.rowData as Record<string, unknown> })),
  };
}

type ProdRow = { fseiban: string | null; fhinmei: string | null; id: string };

export async function loadMhShWinnerRowsForCustomerScaw(client: PrismaClient): Promise<ProdRow[]> {
  return client.$queryRaw<ProdRow[]>`
    SELECT
      "CsvDashboardRow"."rowData"->>'FSEIBAN' AS "fseiban",
      "CsvDashboardRow"."rowData"->>'FHINMEI' AS "fhinmei",
      "CsvDashboardRow"."id"::text AS "id"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'MH%'
        OR UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'SH%'
      )
    ORDER BY "CsvDashboardRow"."id" ASC
  `;
}

/**
 * 同一製番は winner 行走査順で **後勝ち**。
 */
export function buildFseibanToCustomerFromProductionRows(
  productionRows: ProdRow[],
  fankenmeiToCustomer: Map<string, string>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of productionRows) {
    const fseiban = (row.fseiban ?? '').trim();
    if (fseiban.length === 0) continue;
    const key = normalizeCustomerScawMatchKey(row.fhinmei);
    if (key.length === 0) continue;
    const customer = fankenmeiToCustomer.get(key);
    if (!customer) continue;
    out.set(fseiban, customer);
  }
  return out;
}

export async function runCustomerScawReplacementTransaction(
  client: PrismaClient,
  params: {
    resultMeta: Omit<CustomerScawSyncResult, 'upserted' | 'pruned'>;
    createInputs: Prisma.ProductionScheduleFseibanCustomerScawCreateManyInput[];
  }
): Promise<CustomerScawSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleFseibanCustomerScaw.deleteMany({
        where: { sourceCsvDashboardId: PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID },
      });

      let inserted = 0;
      for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
        const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const batch = await tx.productionScheduleFseibanCustomerScaw.createMany({ data: chunk });
        inserted += batch.count;
      }

      if (inserted !== params.createInputs.length) {
        throw new Error(
          `[CustomerScawSync] insert count mismatch: expected ${params.createInputs.length}, got ${inserted}`
        );
      }

      return {
        ...params.resultMeta,
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

export async function runCustomerScawClearTransaction(
  client: PrismaClient,
  resultMeta: Omit<CustomerScawSyncResult, 'upserted' | 'pruned'>
): Promise<CustomerScawSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleFseibanCustomerScaw.deleteMany({
        where: { sourceCsvDashboardId: PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID },
      });
      return {
        ...resultMeta,
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
