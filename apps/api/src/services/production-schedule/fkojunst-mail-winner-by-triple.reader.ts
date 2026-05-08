import { Prisma, type PrismaClient } from '@prisma/client';

import { maxTuplePlaceholdersPerQuery } from '../../lib/postgres-prepared-statement-bind-limit.js';
import { buildFkojunstMailStatusKey } from './fkojunst-mail-status-key.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

/** `csvDashboardId` の 1 バインド + winner 式・将来変更の余裕（winner 条件は Raw でバインド増えない前提） */
const FIXED_BIND_COUNT = 65;

/** タプル1件あたり3バインド（fkojun, fkoteicd, fsezono） */
const BINDS_PER_TUPLE = 3;

/**
 * bind 上限だけでは 1 万件級 tuple `IN` が PostgreSQL の stack depth を超え得る。
 * 本番ログとローカル Docker Postgres 再現では 10900 件で失敗・1000 件で成功。
 */
const STACK_SAFE_MAX_TUPLES_PER_QUERY = 1000;

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
  const startedAt = Date.now();
  const cap = maxTuplePlaceholdersPerQuery(BINDS_PER_TUPLE, FIXED_BIND_COUNT);
  const requested = params.chunkSize ?? cap;
  const chunkSize = Math.min(Math.max(1, requested), cap, STACK_SAFE_MAX_TUPLES_PER_QUERY);

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

  // #region agent log
  fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99aa8f'},body:JSON.stringify({sessionId:'99aa8f',runId:'fkmail-timeout-debug',hypothesisId:'H1',location:'apps/api/src/services/production-schedule/fkojunst-mail-winner-by-triple.reader.ts:60',message:'starting winner triple chunk scan',data:{inputTriples:params.triples.length,uniqueTriples:uniqueTriples.length,cap,chunkSize,totalChunks:Math.ceil(uniqueTriples.length/chunkSize)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const winnerIdByKey = new Map<string, string>();

  for (let i = 0; i < uniqueTriples.length; i += chunkSize) {
    const slice = uniqueTriples.slice(i, i + chunkSize);
    const tupleRows = slice.map((t) => Prisma.sql`(${t.fkojun}, ${t.fkoteicd}, ${t.fsezono})`);
    const tuplesSql = Prisma.join(tupleRows, ', ');
    let winnerRows: WinnerKeyRow[];
    try {
      winnerRows = await params.client.$queryRaw<WinnerKeyRow[]>`
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
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99aa8f'},body:JSON.stringify({sessionId:'99aa8f',runId:'fkmail-timeout-debug',hypothesisId:'H1',location:'apps/api/src/services/production-schedule/fkojunst-mail-winner-by-triple.reader.ts:68',message:'winner triple chunk query failed',data:{chunkIndex:Math.floor(i/chunkSize),sliceSize:slice.length,chunkSize,uniqueTriples:uniqueTriples.length,errorName:error instanceof Error ? error.name : 'unknown',errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      throw error;
    }

    for (const row of winnerRows) {
      const fkojun = normalizeToken(row.fkojun);
      const fkoteicd = normalizeProductionScheduleResourceCd(normalizeToken(row.fkoteicd));
      const fsezono = normalizeToken(row.fsezono);
      if (fkojun.length === 0 || fkoteicd.length === 0 || fsezono.length === 0) continue;
      winnerIdByKey.set(buildFkojunstMailStatusKey({ fkojun, fkoteicd, fsezono }), row.id);
    }
  }

  // #region agent log
  fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99aa8f'},body:JSON.stringify({sessionId:'99aa8f',runId:'fkmail-timeout-debug',hypothesisId:'H1',location:'apps/api/src/services/production-schedule/fkojunst-mail-winner-by-triple.reader.ts:92',message:'completed winner triple chunk scan',data:{elapsedMs:Date.now()-startedAt,winnerIdCount:winnerIdByKey.size,uniqueTriples:uniqueTriples.length,chunkSize},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  return winnerIdByKey;
}

/** @internal テスト用: 既定 chunk 上限（バインド安全域込み） */
export function defaultFkojunstMailWinnerTripleChunkSize(): number {
  return Math.min(
    maxTuplePlaceholdersPerQuery(BINDS_PER_TUPLE, FIXED_BIND_COUNT),
    STACK_SAFE_MAX_TUPLES_PER_QUERY
  );
}

