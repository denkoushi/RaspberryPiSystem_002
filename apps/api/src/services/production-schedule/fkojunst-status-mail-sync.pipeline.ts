/**
 * FKOJUNST_Status Gmail CSV sync: read/normalize → FUPDTEDTで最新化 → winner resolve → delete-by-source + createMany.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
} from './constants.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

const CREATE_MANY_CHUNK_SIZE = 200;
const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;

const ALLOWED_STATUS = new Set(['C', 'P', 'S', 'R', 'X', 'O']);
const INVALID_STATUS_SENTINEL = '?';
const EMPTY_STATUS_SENTINEL = '';
const UNPARSEABLE_DATE_FALLBACK = new Date('1970-01-01T00:00:00.000Z');

export type FkojunstMailNormalizedRow = {
  sourceRowId: string;
  fkojun: string;
  fkoteicd: string;
  fsezono: string;
  statusCode: string;
  sourceUpdatedAt: Date;
  hasUnparseableDate: boolean;
};

type WinnerKeyRow = {
  id: string;
  fkojun: string | null;
  fkoteicd: string | null;
  fsezono: string | null;
};

export type FkojunstMailSyncResult = {
  scanned: number;
  normalized: number;
  matched: number;
  unmatched: number;
  skippedInvalidStatus: number;
  skippedUnparseableDate: number;
  upserted: number;
  pruned: number;
};

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

function normalizeStatusCode(value: unknown): string | null {
  const s = normalizeToken(value).toUpperCase();
  if (s.length !== 1) return null;
  return ALLOWED_STATUS.has(s) ? s : null;
}

export function parseFkojunstStatusMailFupdteDt(value: unknown): Date | null {
  const s = normalizeToken(value);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yyyy, HH, MM, ss] = m;
  const d = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(HH),
    Number(MM),
    Number(ss)
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildFkojunstMailStatusKey(parts: { fkojun: string; fkoteicd: string; fsezono: string }): string {
  return `${parts.fkojun}\t${parts.fkoteicd}\t${parts.fsezono}`;
}

export function toFkojunstMailNormalizedRow(
  sourceRowId: string,
  rowData: Record<string, unknown>
): { row: FkojunstMailNormalizedRow | null; skippedInvalidStatus: boolean; skippedUnparseableDate: boolean } {
  const fkojun = normalizeToken(rowData.FKOJUN);
  const fkoteicd = normalizeProductionScheduleResourceCd(normalizeToken(rowData.FKOTEICD));
  const fsezono = normalizeToken(rowData.FSEZONO);
  const rawStatus = normalizeToken(rowData.FKOJUNST);
  const statusCode = normalizeStatusCode(rowData.FKOJUNST);
  const sourceUpdatedAt = parseFkojunstStatusMailFupdteDt(rowData.FUPDTEDT);

  let skippedInvalidStatus = false;
  if (rawStatus.length > 0 && statusCode === null) {
    skippedInvalidStatus = true;
  }
  if (fkojun.length === 0 || fkoteicd.length === 0 || fsezono.length === 0) {
    return { row: null, skippedInvalidStatus, skippedUnparseableDate: false };
  }

  const persistedStatusCode =
    statusCode ?? (rawStatus.length === 0 ? EMPTY_STATUS_SENTINEL : INVALID_STATUS_SENTINEL);
  const hasUnparseableDate = sourceUpdatedAt === null;

  return {
    row: {
      sourceRowId,
      fkojun,
      fkoteicd,
      fsezono,
      statusCode: persistedStatusCode,
      sourceUpdatedAt: sourceUpdatedAt ?? UNPARSEABLE_DATE_FALLBACK,
      hasUnparseableDate,
    },
    skippedInvalidStatus,
    skippedUnparseableDate: hasUnparseableDate,
  };
}

/** 同一キーは FUPDTEDT 最大の行のみ残す */
export function dedupeFkojunstMailRowsByLatest(rows: FkojunstMailNormalizedRow[]): FkojunstMailNormalizedRow[] {
  const byKey = new Map<string, FkojunstMailNormalizedRow>();
  for (const row of rows) {
    const key = buildFkojunstMailStatusKey({
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
    });
    const prev = byKey.get(key);
    if (
      !prev ||
      (row.hasUnparseableDate && !prev.hasUnparseableDate) ||
      (row.hasUnparseableDate === prev.hasUnparseableDate &&
        row.sourceUpdatedAt.getTime() > prev.sourceUpdatedAt.getTime())
    ) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

export async function loadFkojunstMailSourceRows(client: PrismaClient): Promise<{
  scanned: number;
  normalizedRows: FkojunstMailNormalizedRow[];
  skippedInvalidStatus: number;
  skippedUnparseableDate: number;
}> {
  const sourceRows = await client.csvDashboardRow.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID },
    select: { id: true, rowData: true },
  });

  let skippedInvalidStatus = 0;
  let skippedUnparseableDate = 0;
  const normalizedRows: FkojunstMailNormalizedRow[] = [];
  for (const row of sourceRows) {
    const rd = row.rowData as Record<string, unknown>;
    const parsed = toFkojunstMailNormalizedRow(row.id, rd);
    if (parsed.skippedInvalidStatus) skippedInvalidStatus += 1;
    if (parsed.skippedUnparseableDate) skippedUnparseableDate += 1;
    if (parsed.row) {
      normalizedRows.push(parsed.row);
    }
  }

  return { scanned: sourceRows.length, normalizedRows, skippedInvalidStatus, skippedUnparseableDate };
}

export async function resolveFkojunstMailWinnerIdByKey(
  client: PrismaClient,
  dedupedRows: FkojunstMailNormalizedRow[]
): Promise<Map<string, string>> {
  if (dedupedRows.length === 0) {
    return new Map();
  }

  const fkojuns = [...new Set(dedupedRows.map((row) => row.fkojun))];
  const fkoteicds = [...new Set(dedupedRows.map((row) => row.fkoteicd))];
  const fsezonos = [...new Set(dedupedRows.map((row) => row.fsezono))];

  const winnerRows = await client.$queryRaw<WinnerKeyRow[]>`
    SELECT
      "CsvDashboardRow"."id" AS "id",
      BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') AS "fkojun",
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "fkoteicd",
      BTRIM("CsvDashboardRow"."rowData"->>'ProductNo') AS "fsezono"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') IN (${Prisma.join(fkojuns.map((value) => Prisma.sql`${value}`), ',')})
      AND UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) IN (${Prisma.join(fkoteicds.map((value) => Prisma.sql`${value}`), ',')})
      AND BTRIM("CsvDashboardRow"."rowData"->>'ProductNo') IN (${Prisma.join(fsezonos.map((value) => Prisma.sql`${value}`), ',')})
  `;

  const winnerIdByKey = new Map<string, string>();
  for (const row of winnerRows) {
    const fkojun = normalizeToken(row.fkojun);
    const fkoteicd = normalizeProductionScheduleResourceCd(normalizeToken(row.fkoteicd));
    const fsezono = normalizeToken(row.fsezono);
    if (fkojun.length === 0 || fkoteicd.length === 0 || fsezono.length === 0) continue;
    winnerIdByKey.set(buildFkojunstMailStatusKey({ fkojun, fkoteicd, fsezono }), row.id);
  }
  return winnerIdByKey;
}

export function buildFkojunstMailReplacementCreateInputs(
  dedupedRows: FkojunstMailNormalizedRow[],
  winnerIdByKey: Map<string, string>
): {
  matched: number;
  unmatched: number;
  createInputs: Prisma.ProductionScheduleFkojunstMailStatusCreateManyInput[];
} {
  let matched = 0;
  let unmatched = 0;
  const createInputs: Prisma.ProductionScheduleFkojunstMailStatusCreateManyInput[] = [];

  for (const row of dedupedRows) {
    const key = buildFkojunstMailStatusKey({
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
    });
    const winnerRowId = winnerIdByKey.get(key);
    if (!winnerRowId) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    createInputs.push({
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: winnerRowId,
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
      statusCode: row.statusCode,
      sourceUpdatedAt: row.sourceUpdatedAt,
    });
  }

  return { matched, unmatched, createInputs };
}

export async function runFkojunstMailReplacementTransaction(
  client: PrismaClient,
  params: {
    scanned: number;
    normalized: number;
    matched: number;
    unmatched: number;
    skippedInvalidStatus: number;
    skippedUnparseableDate: number;
    createInputs: Prisma.ProductionScheduleFkojunstMailStatusCreateManyInput[];
  }
): Promise<FkojunstMailSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleFkojunstMailStatus.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        },
      });

      let inserted = 0;
      for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
        const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const batch = await tx.productionScheduleFkojunstMailStatus.createMany({ data: chunk });
        inserted += batch.count;
      }

      if (inserted !== params.createInputs.length) {
        throw new Error(
          `[FkojunstMailSync] insert count mismatch: expected ${params.createInputs.length}, got ${inserted}`
        );
      }

      return {
        scanned: params.scanned,
        normalized: params.normalized,
        matched: params.matched,
        unmatched: params.unmatched,
        skippedInvalidStatus: params.skippedInvalidStatus,
        skippedUnparseableDate: params.skippedUnparseableDate,
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

export async function runFkojunstMailClearTransaction(
  client: PrismaClient,
  scanned: number,
  skippedInvalidStatus: number,
  skippedUnparseableDate: number
): Promise<FkojunstMailSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleFkojunstMailStatus.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        },
      });
      return {
        scanned,
        normalized: 0,
        matched: 0,
        unmatched: 0,
        skippedInvalidStatus,
        skippedUnparseableDate,
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
