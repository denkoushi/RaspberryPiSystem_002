import type { PrismaClient } from '@prisma/client';

import { buildFkojunstMailStatusKey } from './fkojunst-mail-status-key.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

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

  const requestedKeys = new Set(
    uniqueTriples.map((triple) =>
      buildFkojunstMailStatusKey({
        fkojun: triple.fkojun,
        fkoteicd: triple.fkoteicd,
        fsezono: triple.fsezono,
      })
    )
  );

  const winnerRows = await params.client.$queryRaw<WinnerKeyRow[]>`
    SELECT
      "CsvDashboardRow"."id" AS "id",
      BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') AS "fkojun",
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "fkoteicd",
      BTRIM("CsvDashboardRow"."rowData"->>'ProductNo') AS "fsezono"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${params.productionScheduleDashboardId}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
  `;

  const winnerIdByKey = new Map<string, string>();
  for (const row of winnerRows) {
    const fkojun = normalizeToken(row.fkojun);
    const fkoteicd = normalizeProductionScheduleResourceCd(normalizeToken(row.fkoteicd));
    const fsezono = normalizeToken(row.fsezono);
    if (fkojun.length === 0 || fkoteicd.length === 0 || fsezono.length === 0) continue;
    const key = buildFkojunstMailStatusKey({ fkojun, fkoteicd, fsezono });
    if (requestedKeys.has(key)) {
      winnerIdByKey.set(key, row.id);
    }
  }

  return winnerIdByKey;
}

