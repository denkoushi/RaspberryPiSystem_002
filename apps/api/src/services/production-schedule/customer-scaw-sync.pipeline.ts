/**
 * Gmail 件名 CustomerSCAW の CSV を取り込んだ実行について、MH/SH winner 行の FHINMEI と
 * FANKENMEI を正規化照合し `ProductionScheduleFseibanCustomerScaw` を source 単位で全置換する。
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  buildFankenmeiKeyToCandidates,
  pickCustomerNameFromCandidates,
  type CustomerScawCsvCandidate,
} from './customer-scaw-candidates.js';
import { normalizeCustomerScawMatchKey } from './customer-scaw-normalize.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

export type { CustomerScawCsvCandidate };

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
 * 同一 FANKENMEI（正規化キー）は CSV 走査順で **後勝ち**（着手日を使わない集約）。
 * `FANKENYMD` 近傍判定は {@link buildFankenmeiKeyToCandidates} を使用する。
 */
export function buildFankenmeiToCustomerLastWins(
  orderedRows: Array<{ rowData: Record<string, unknown> }>
): Map<string, string> {
  const candidatesByKey = buildFankenmeiKeyToCandidates(orderedRows);
  const map = new Map<string, string>();
  for (const [key, list] of candidatesByKey) {
    const last = list[list.length - 1];
    if (last) {
      map.set(key, last.customerName);
    }
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

export type ProdRow = {
  fseiban: string | null;
  fhinmei: string | null;
  id: string;
  plannedStartDate: Date | null;
};

export async function loadMhShWinnerRowsForCustomerScaw(client: PrismaClient): Promise<ProdRow[]> {
  return client.$queryRaw<ProdRow[]>`
    SELECT
      "r"."rowData"->>'FSEIBAN' AS "fseiban",
      "r"."rowData"->>'FHINMEI' AS "fhinmei",
      "r"."id"::text AS "id",
      "seiban_sup"."plannedStartDate" AS "plannedStartDate"
    FROM "CsvDashboardRow" AS "r"
    LEFT JOIN (
      SELECT
        "src"."rowData"->>'FSEIBAN' AS "fseiban",
        MIN("sup"."plannedStartDate") AS "plannedStartDate"
      FROM "CsvDashboardRow" AS "src"
      INNER JOIN "ProductionScheduleOrderSupplement" AS "sup"
        ON "sup"."csvDashboardRowId" = "src"."id"
        AND "sup"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      WHERE "src"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('src')}
      GROUP BY "src"."rowData"->>'FSEIBAN'
    ) AS "seiban_sup"
      ON "seiban_sup"."fseiban" = ("r"."rowData"->>'FSEIBAN')
    WHERE "r"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('r')}
      AND (
        UPPER(COALESCE("r"."rowData"->>'FHINCD', '')) LIKE 'MH%'
        OR UPPER(COALESCE("r"."rowData"->>'FHINCD', '')) LIKE 'SH%'
      )
    ORDER BY "r"."id" ASC
  `;
}

/**
 * 同一製番は winner 行走査順で **後勝ち**（行ごとに Customer を決めたうえで上書き）。
 */
export function buildFseibanToCustomerFromProductionRows(
  productionRows: ProdRow[],
  fankenmeiKeyToCandidates: Map<string, CustomerScawCsvCandidate[]>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of productionRows) {
    const fseiban = (row.fseiban ?? '').trim();
    if (fseiban.length === 0) continue;
    const key = normalizeCustomerScawMatchKey(row.fhinmei);
    if (key.length === 0) continue;
    const customer = pickCustomerNameFromCandidates(fankenmeiKeyToCandidates.get(key), row.plannedStartDate);
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
