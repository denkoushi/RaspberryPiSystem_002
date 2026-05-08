import { Prisma, type PrismaClient } from '@prisma/client';

import { maxTuplePlaceholdersPerQuery } from '../../lib/postgres-prepared-statement-bind-limit.js';
import { buildFkojunstMailStatusKey } from './fkojunst-mail-status-key.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

/** `csvDashboardId` の 1 バインド + winner 式・将来変更の余裕（winner 条件は Raw でバインド増えない前提） */
const FIXED_BIND_COUNT = 65;

/** タプル1件あたり3バインド（fkojun, fkoteicd, fsezono） */
const BINDS_PER_TUPLE = 3;

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

type WinnerKeyRow = {
  id: string;
  fkojun: string | null;
  fkoteicd: string | null;
  fsezono: string | null;
};

export type FkojunstMailWinnerTripleClient = Pick<PrismaClient, '$queryRaw'>;

export type FkojunstMailWinnerTripleInput = {
  fkojun: string;
  fkoteicd: string;
  fsezono: string;
};

/**
 * メール側の実3キー（dedupe 済み想定）ごとに、生産スケジュール幕の winner `CsvDashboardRow.id` を引く。
 * PostgreSQL のバインド上限を超えないよう、複合キーをチャンクして `$queryRaw` を逐次実行する。
 */
export async function findFkojunstMailWinnerIdsByMailTriples(params: {
  client: FkojunstMailWinnerTripleClient;
  productionScheduleDashboardId: string;
  triples: FkojunstMailWinnerTripleInput[];
  chunkSize?: number;
}): Promise<Map<string, string>> {
  const cap = maxTuplePlaceholdersPerQuery(BINDS_PER_TUPLE, FIXED_BIND_COUNT);
  const requested = params.chunkSize ?? cap;
  const chunkSize = Math.min(Math.max(1, requested), cap);

  const keyToTriple = new Map<string, FkojunstMailWinnerTripleInput>();
  for (const t of params.triples) {
    const fkojun = normalizeToken(t.fkojun);
    const fkoteicd = normalizeProductionScheduleResourceCd(normalizeToken(t.fkoteicd));
    const fsezono = normalizeToken(t.fsezono);
    if (fkojun.length === 0 || fkoteicd.length === 0 || fsezono.length === 0) {
      continue;
    }
    keyToTriple.set(buildFkojunstMailStatusKey({ fkojun, fkoteicd, fsezono }), { fkojun, fkoteicd, fsezono });
  }

  const uniqueTriples = [...keyToTriple.values()];
  if (uniqueTriples.length === 0) {
    return new Map();
  }

  const winnerIdByKey = new Map<string, string>();

  for (let i = 0; i < uniqueTriples.length; i += chunkSize) {
    const slice = uniqueTriples.slice(i, i + chunkSize);
    const tupleRows = slice.map((t) => Prisma.sql`(${t.fkojun}, ${t.fkoteicd}, ${t.fsezono})`);
    const tuplesSql = Prisma.join(tupleRows, ', ');

    const winnerRows = await params.client.$queryRaw<WinnerKeyRow[]>`
      SELECT
        "CsvDashboardRow"."id" AS "id",
        BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') AS "fkojun",
        UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "fkoteicd",
        BTRIM("CsvDashboardRow"."rowData"->>'ProductNo') AS "fsezono"
      FROM "CsvDashboardRow"
      WHERE "CsvDashboardRow"."csvDashboardId" = ${params.productionScheduleDashboardId}
        AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
        AND (
          BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN'),
          UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')),
          BTRIM("CsvDashboardRow"."rowData"->>'ProductNo')
        ) IN (${tuplesSql})
    `;

    for (const row of winnerRows) {
      const fkojun = normalizeToken(row.fkojun);
      const fkoteicd = normalizeProductionScheduleResourceCd(normalizeToken(row.fkoteicd));
      const fsezono = normalizeToken(row.fsezono);
      if (fkojun.length === 0 || fkoteicd.length === 0 || fsezono.length === 0) continue;
      winnerIdByKey.set(buildFkojunstMailStatusKey({ fkojun, fkoteicd, fsezono }), row.id);
    }
  }

  return winnerIdByKey;
}

/** @internal テスト用: 既定 chunk 上限（バインド安全域込み） */
export function defaultFkojunstMailWinnerTripleChunkSize(): number {
  return maxTuplePlaceholdersPerQuery(BINDS_PER_TUPLE, FIXED_BIND_COUNT);
}

