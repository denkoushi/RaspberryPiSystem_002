/**
 * 生産日程で「振り直しで古くなった製造オーダー番号」に印(CsvDashboardRow.supersededAt)を付け直す。
 *
 * 定義: 行の (ProductNo, FSIGENCD, FKOJUN) の工程状態が X で、同じ4列キー(FSEIBAN+FHINCD+FSIGENCD+FKOJUN)に
 * 工程状態が X でない別の ProductNo の行がある → 印を付ける。条件に合わなくなった行は印を外す。
 * 3列で一致する状態が無いときは、(ProductNo, FKOJUN) の最新状態が1件以上あり、全部 X の場合だけ X とみなす。
 * 工程状態が無い番号(取り込み直後など)は X でない扱い。両方 X のときは両方見える。
 *
 * 工程状態の正本は FKOJUNST_Status メールの生データ(ADR-20260508)。行に付けた状態の表
 * (ProductionScheduleFkojunstMailStatus / FkojunstStatus)は同期前で空のことがあるため読まない。
 * 呼ぶ順序は「印の付け直し → 状態の付与」。
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { chunk } from '../../lib/chunk.js';
import { toTrimmedString as normalizeToken } from '../../lib/string-normalize.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from './fkojunst-status-mail-critical-lock.js';
import { buildFkojunstMailStatusKey } from './fkojunst-mail-status-key.js';
import {
  fetchFkojunstStatusMailSourceRowsOrdered,
  hasVisibleFkojunstStatusMailSourceRows,
} from './fkojunst-status-mail-source-rows.reader.js';
import {
  collectFkojunstMailNormalizedRowsFromSourceRows,
  dedupeFkojunstMailRowsByLatest,
} from './fkojunst-status-mail-sync.pipeline.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { carryOverSupersededOrderData, lockSupersededOrderCarryOverPairs, type CarryOverCounts } from './superseded-order-carry-over.js';

export const SUPERSEDED_STATUS_CODE = 'X';
const UPDATE_CHUNK_SIZE = 5000;

export type SupersedeCandidateRow = {
  id: string;
  fseiban: string;
  fhincd: string;
  fsigencd: string;
  fkojun: string;
  productNo: string;
};

/** FKOTEICD が空のキーは、同じ製造番号・工順の全工程コードの集約結果。 */
type MarkerStatusByKey = ReadonlyMap<string, string>;

export type SupersededRefreshResult = {
  total: number;
  marked: number;
  cleared: number;
  supersededNow: number;
  carriedOver: CarryOverCounts | null;
};

type TxClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
type MarkerClient = PrismaClient | Prisma.TransactionClient;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

const statusKeyOf = (row: SupersedeCandidateRow): string =>
  buildFkojunstMailStatusKey({
    fkojun: normalizeToken(row.fkojun),
    fkoteicd: normalizeProductionScheduleResourceCd(normalizeToken(row.fsigencd)),
    fsezono: normalizeToken(row.productNo),
  });

const statusKeyWithoutResource = (fkojun: string, fsezono: string): string =>
  buildFkojunstMailStatusKey({ fkojun, fkoteicd: '', fsezono });

function groupRowsWithMultipleProductNos(rows: readonly SupersedeCandidateRow[]): SupersedeCandidateRow[][] {
  const groups = new Map<string, SupersedeCandidateRow[]>();
  for (const row of rows) {
    // DB の winner 条件と同じく、4列は COALESCE(...,'') の完全一致(trim しない)で同じキーとみなす
    const groupKey = JSON.stringify([row.fseiban, row.fhincd, row.fsigencd, row.fkojun]);
    const group = groups.get(groupKey);
    if (group) group.push(row);
    else groups.set(groupKey, [row]);
  }
  return [...groups.values()].filter((group) => {
    if (group.length < 2) return false;
    const productNo = normalizeToken(group[0].productNo);
    return group.some((row) => normalizeToken(row.productNo) !== productNo);
  });
}

/** 印を付けるべき行 id の集合(純粋関数)。 */
export function computeSupersededRowIds(
  rows: readonly SupersedeCandidateRow[],
  statusByKey: MarkerStatusByKey
): Set<string> {
  return computeSupersededGroupRowIds(groupRowsWithMultipleProductNos(rows), statusByKey);
}

function computeSupersededGroupRowIds(
  groups: readonly SupersedeCandidateRow[][],
  statusByKey: MarkerStatusByKey
): Set<string> {
  const isX = (row: SupersedeCandidateRow) => {
    const status = statusByKey.get(statusKeyOf(row))
      ?? statusByKey.get(statusKeyWithoutResource(normalizeToken(row.fkojun), normalizeToken(row.productNo)));
    return status === SUPERSEDED_STATUS_CODE;
  };
  const superseded = new Set<string>();
  for (const group of groups) {
    const alive = group.filter((row) => !isX(row));
    if (alive.length === 0) continue; // 全部 X なら全部見える
    for (const row of group) {
      if (!isX(row)) continue;
      // 生きている番号が、この行とは別の ProductNo であること
      const hasOtherAliveProductNo = alive.some(
        (other) => normalizeToken(other.productNo) !== normalizeToken(row.productNo)
      );
      if (hasOtherAliveProductNo) superseded.add(row.id);
    }
  }
  return superseded;
}

export function statusByKeyFromDedupedMailRows(
  dedupedRows: ReadonlyArray<{ fkojun: string; fkoteicd: string; fsezono: string; statusCode: string }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of dedupedRows) {
    map.set(
      buildFkojunstMailStatusKey({ fkojun: row.fkojun, fkoteicd: row.fkoteicd, fsezono: row.fsezono }),
      row.statusCode
    );
    // 正規化済みの3列キーには空の FKOTEICD は無い。非 X が一度でもあれば空文字を保持する。
    const processKey = statusKeyWithoutResource(row.fkojun, row.fsezono);
    if (row.statusCode !== SUPERSEDED_STATUS_CODE) map.set(processKey, '');
    else if (!map.has(processKey)) map.set(processKey, SUPERSEDED_STATUS_CODE);
  }
  return map;
}

type ScheduleRow = SupersedeCandidateRow & { marked: boolean };

/** 実際に状態が変わった行 id を返す(mark なら NULL → 値になった行)。 */
async function updateInChunks(client: TxClient, ids: readonly string[], mode: 'mark' | 'clear'): Promise<string[]> {
  const changed: string[] = [];
  for (const batchIds of chunk(ids, UPDATE_CHUNK_SIZE)) {
    // updatedAt も進める(見える行の集合が変わるので、世代を見ているキャッシュを無効にする)
    const updated = await client.$queryRaw<Array<{ id: string }>>(
      mode === 'mark'
        ? Prisma.sql`UPDATE "CsvDashboardRow" SET "supersededAt" = NOW(), "updatedAt" = NOW()
            WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
              AND "id" = ANY(${batchIds}::text[]) AND "supersededAt" IS NULL
            RETURNING "id"`
        : Prisma.sql`UPDATE "CsvDashboardRow" SET "supersededAt" = NULL, "updatedAt" = NOW()
            WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
              AND "id" = ANY(${batchIds}::text[]) AND "supersededAt" IS NOT NULL
            RETURNING "id"`
    );
    for (const row of updated) changed.push(row.id);
  }
  return changed;
}

/** 印と引き継ぎを同じトランザクションで更新する。 */
export async function refreshSupersededProductionScheduleRows(
  client: MarkerClient,
  options?: { statusByKey?: MarkerStatusByKey }
): Promise<SupersededRefreshResult> {
  const refresh = async (tx: Prisma.TransactionClient): Promise<SupersededRefreshResult> => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('production-schedule-superseded-refresh'),
        hashtext(${PRODUCTION_SCHEDULE_DASHBOARD_ID})
      )
    `;
    // Cut operations and mail ingestion use this lock before any piece or row locks.
    await acquireFkojunstStatusMailCriticalTransactionLock(tx);
    const rows = await tx.$queryRaw<ScheduleRow[]>(Prisma.sql`
      SELECT
        "id",
        COALESCE("rowData"->>'FSEIBAN', '') AS "fseiban",
        COALESCE("rowData"->>'FHINCD', '') AS "fhincd",
        COALESCE("rowData"->>'FSIGENCD', '') AS "fsigencd",
        COALESCE("rowData"->>'FKOJUN', '') AS "fkojun",
        BTRIM(COALESCE("rowData"->>'ProductNo', '')) AS "productNo",
        ("supersededAt" IS NOT NULL) AS "marked"
      FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    `);

    const groups = groupRowsWithMultipleProductNos(rows);
    let statusByKey = options?.statusByKey;
    if (statusByKey === undefined) {
      const productNos = [...new Set(groups.flatMap((group) => group.map((row) => normalizeToken(row.productNo))))].filter(Boolean);
      // Ingestion trims FSEZONO. Use the indexed expression and bind all candidates as one array.
      const sourceRows = productNos.length === 0 ? [] : await fetchFkojunstStatusMailSourceRowsOrdered(tx, {
        where: Prisma.sql`BTRIM(r."rowData"->>'FSEZONO') = ANY(${productNos}::text[])`,
      });
      if (sourceRows.length === 0 && !(await hasVisibleFkojunstStatusMailSourceRows(tx))) {
        return { total: rows.length, marked: 0, cleared: 0, supersededNow: rows.filter((row) => row.marked).length, carriedOver: null };
      }
      const { normalizedRows } = collectFkojunstMailNormalizedRowsFromSourceRows(sourceRows);
      statusByKey = statusByKeyFromDedupedMailRows(dedupeFkojunstMailRowsByLatest(normalizedRows));
    }

    const shouldMark = computeSupersededGroupRowIds(groups, statusByKey);
    const toMark = rows.filter((row) => shouldMark.has(row.id) && !row.marked).map((row) => row.id);
    const toClear = rows.filter((row) => !shouldMark.has(row.id) && row.marked).map((row) => row.id);

    const pairs = await lockSupersededOrderCarryOverPairs(tx, toMark, toClear);
    const newlyMarked = new Set(await updateInChunks(tx, toMark, 'mark'));
    const cleared = await updateInChunks(tx, toClear, 'clear');
    const carriedOver = newlyMarked.size > 0
      ? await carryOverSupersededOrderData(tx, pairs.filter((pair) => newlyMarked.has(pair.oldId)))
      : null;
    return { total: rows.length, marked: newlyMarked.size, cleared: cleared.length, supersededNow: shouldMark.size, carriedOver };
  };

  return '$transaction' in client ? client.$transaction(refresh, TRANSACTION_OPTIONS) : refresh(client);
}
