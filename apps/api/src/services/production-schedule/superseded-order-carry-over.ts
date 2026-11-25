/**
 * 振り直しで古くなった番号(印を新しく付けた行)から、新しい番号の行へ備考などを移す。
 *
 * 全番号を別の行として残すようになったので、振り直しで同じ行の番号だけが変わっていた頃の
 * 自然な引き継ぎが切れる。印を付けるのと同じトランザクションの中で、次を「移す」(コピーではなく付け替え)。
 * 引き継ぎ先に同じ種類のものが既にあれば古い行のものはそのまま残す。
 *
 * 引き継ぎ先 = 同じ4列キー(完全一致)で印の無い行のうち、ProductNo が数値として最大の行(winner と同じ順)。
 * 切削の分割(SessakuPieceSet / SessakuPieceHistory)は、同じ4列キーの古い ProductNo のものを引き継ぎ先の ProductNo に付け替える。
 * 移さないもの(取り込みで自動で付く): OrderSupplement / FkojunstStatus / FkojunstMailStatus / ExternalCompletion。
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { chunk } from '../../lib/chunk.js';
import { logger } from '../../lib/logger.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, sessakuPieceParentItemId, type SessakuPieceLogicalKey } from './sessaku-pieces/piece-key.js';
import { buildMaxProductNoWinnerSelectionOrderBySql } from './row-resolver/max-product-no-winner-spec.js';

export type CarryOverClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

export type CarryOverCounts = {
  targets: number;
  rowNotes: number;
  orderAssignments: number;
  globalRowRanks: number;
  orderSplits: number;
  progress: number;
  grindingOverrides: number;
  grindingArrivals: number;
  grindingFirstProcessArrivals: number;
  sessakuPieceSets: number;
  sessakuPieceHistories: number;
};

export type CarryOverPair = {
  oldId: string;
  targetId: string;
  oldItemKey: string;
  targetItemKey: string;
  oldPieceKey: SessakuPieceLogicalKey;
  targetPieceKey: SessakuPieceLogicalKey;
  hasPieceData: boolean;
};

const CHUNK_SIZE = 5000;

type PairRow = {
  oldId: string;
  targetId: string;
  oldFseiban: string;
  oldFhincd: string;
  oldFsigencd: string;
  oldFkojun: string;
  oldProductNo: string;
  targetFseiban: string;
  targetFhincd: string;
  targetFsigencd: string;
  targetFkojun: string;
  targetProductNo: string;
  hasPieceData: boolean;
};

/** 古い行ごとの引き継ぎ先を決める。古い ProductNo が大きい順(ord の小さいほうを優先して移す)。 */
async function resolveCarryOverPairs(
  client: Pick<PrismaClient, '$queryRaw'>,
  oldIds: readonly string[],
  toClear: readonly string[]
): Promise<CarryOverPair[]> {
  if (oldIds.length === 0) return [];
  const orderBy = buildMaxProductNoWinnerSelectionOrderBySql('t');
  const oldOrderBy = buildMaxProductNoWinnerSelectionOrderBySql('o');
  const rows = await client.$queryRaw<PairRow[]>(Prisma.sql`
    SELECT
      o."id" AS "oldId", t."id" AS "targetId",
      COALESCE(o."rowData"->>'FSEIBAN', '') AS "oldFseiban",
      COALESCE(o."rowData"->>'FHINCD', '') AS "oldFhincd",
      COALESCE(o."rowData"->>'FSIGENCD', '') AS "oldFsigencd",
      COALESCE(o."rowData"->>'FKOJUN', '') AS "oldFkojun",
      COALESCE(o."rowData"->>'ProductNo', '') AS "oldProductNo",
      COALESCE(t."rowData"->>'FSEIBAN', '') AS "targetFseiban",
      COALESCE(t."rowData"->>'FHINCD', '') AS "targetFhincd",
      COALESCE(t."rowData"->>'FSIGENCD', '') AS "targetFsigencd",
      COALESCE(t."rowData"->>'FKOJUN', '') AS "targetFkojun",
      COALESCE(t."rowData"->>'ProductNo', '') AS "targetProductNo",
      EXISTS (
        SELECT 1 FROM (
          SELECT "csvDashboardId", "fseiban", "fhincd", "fsigencd", "fkojun", "productNo"
          FROM "ProductionScheduleSessakuPieceSet"
          UNION ALL
          SELECT "csvDashboardId", "fseiban", "fhincd", "fsigencd", "fkojun", "productNo"
          FROM "ProductionScheduleSessakuPieceHistory"
        ) AS piece_data
        WHERE piece_data."csvDashboardId" = o."csvDashboardId"
          AND piece_data."fseiban" = COALESCE(o."rowData"->>'FSEIBAN', '')
          AND piece_data."fhincd" = COALESCE(o."rowData"->>'FHINCD', '')
          AND piece_data."fsigencd" = COALESCE(o."rowData"->>'FSIGENCD', '')
          AND piece_data."fkojun" = COALESCE(o."rowData"->>'FKOJUN', '')
          AND piece_data."productNo" = COALESCE(o."rowData"->>'ProductNo', '')
      ) AS "hasPieceData"
    FROM "CsvDashboardRow" o
    JOIN LATERAL (
      SELECT t.* FROM "CsvDashboardRow" t
      WHERE t."csvDashboardId" = o."csvDashboardId"
        AND (t."supersededAt" IS NULL OR t."id" = ANY(${[...toClear]}::text[]))
        AND NOT (t."id" = ANY(${[...oldIds]}::text[]))
        AND COALESCE(t."rowData"->>'FSEIBAN', '') = COALESCE(o."rowData"->>'FSEIBAN', '')
        AND COALESCE(t."rowData"->>'FHINCD', '') = COALESCE(o."rowData"->>'FHINCD', '')
        AND COALESCE(t."rowData"->>'FSIGENCD', '') = COALESCE(o."rowData"->>'FSIGENCD', '')
        AND COALESCE(t."rowData"->>'FKOJUN', '') = COALESCE(o."rowData"->>'FKOJUN', '')
      ORDER BY ${Prisma.raw(orderBy)}
      LIMIT 1
    ) t ON TRUE
    WHERE o."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND o."id" = ANY(${[...oldIds]}::text[])
    ORDER BY ${Prisma.raw(oldOrderBy)}
  `);
  return rows.map((row) => {
    const oldPieceKey = {
      fseiban: row.oldFseiban, fhincd: row.oldFhincd, fsigencd: row.oldFsigencd, fkojun: row.oldFkojun, productNo: row.oldProductNo,
    };
    const targetPieceKey = {
      fseiban: row.targetFseiban, fhincd: row.targetFhincd, fsigencd: row.targetFsigencd, fkojun: row.targetFkojun, productNo: row.targetProductNo,
    };
    return {
      oldId: row.oldId, targetId: row.targetId, oldPieceKey, targetPieceKey, hasPieceData: row.hasPieceData,
      oldItemKey: sessakuPieceParentItemId(oldPieceKey), targetItemKey: sessakuPieceParentItemId(targetPieceKey),
    };
  });
}

/** Resolve against the visibility after this refresh, then lock before updating any schedule row. */
export async function lockSupersededOrderCarryOverPairs(
  tx: Prisma.TransactionClient,
  toMark: readonly string[],
  toClear: readonly string[]
): Promise<CarryOverPair[]> {
  const pairs = await resolveCarryOverPairs(tx, toMark, toClear);
  // The caller holds the mail critical lock, which also excludes new piece-set creation.
  const pieceKeys = pairs.filter((pair) => pair.hasPieceData)
    .flatMap(({ oldPieceKey, targetPieceKey }) => [oldPieceKey, targetPieceKey]);
  if (pieceKeys.length > 0) await acquireSessakuPieceLogicalLocks(tx, pieceKeys);
  if (pairs.length > 0) await acquireSessakuPieceBoardStateLocks(tx);
  return pairs;
}

const idPairs = (oldIds: readonly string[], targetIds: readonly string[]) =>
  Prisma.sql`unnest(${[...oldIds]}::text[], ${[...targetIds]}::text[]) WITH ORDINALITY AS m("old_id", "target_id", "ord")`;

const keyPairs = (oldKeys: readonly string[], newKeys: readonly string[]) =>
  Prisma.sql`unnest(${[...oldKeys]}::text[], ${[...newKeys]}::text[]) WITH ORDINALITY AS m("old_key", "new_key", "ord")`;

/**
 * ロック済みの組について、印を新しく付けた行から引き継ぎ先へ移す。
 * 同じ組を2回渡しても、2回目は引き継ぎ先に既にあるので何も移らない。
 */
export async function carryOverSupersededOrderData(
  client: CarryOverClient,
  pairs: readonly CarryOverPair[]
): Promise<CarryOverCounts> {
  const counts: CarryOverCounts = {
    targets: pairs.length, rowNotes: 0, orderAssignments: 0, globalRowRanks: 0, orderSplits: 0, progress: 0,
    grindingOverrides: 0, grindingArrivals: 0, grindingFirstProcessArrivals: 0,
    sessakuPieceSets: 0, sessakuPieceHistories: 0,
  };

  for (const batch of chunk(pairs, CHUNK_SIZE)) {
    const o = batch.map((p) => p.oldId);
    const t = batch.map((p) => p.targetId);

    counts.rowNotes += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (m."target_id") n."id" AS "row_id", m."target_id"
        FROM ${idPairs(o, t)}
        JOIN "ProductionScheduleRowNote" n ON n."csvDashboardRowId" = m."old_id"
        WHERE NOT EXISTS (SELECT 1 FROM "ProductionScheduleRowNote" x WHERE x."csvDashboardRowId" = m."target_id")
        ORDER BY m."target_id", m."ord"
      )
      UPDATE "ProductionScheduleRowNote" n SET "csvDashboardRowId" = c."target_id", "updatedAt" = NOW()
      FROM cand c WHERE n."id" = c."row_id"`);

    counts.orderAssignments += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (m."target_id", a."location") a."id" AS "row_id", m."target_id"
        FROM ${idPairs(o, t)}
        JOIN "ProductionScheduleOrderAssignment" a ON a."csvDashboardRowId" = m."old_id"
        WHERE NOT EXISTS (
          SELECT 1 FROM "ProductionScheduleOrderAssignment" x
          WHERE x."csvDashboardRowId" = m."target_id" AND x."location" = a."location")
        ORDER BY m."target_id", a."location", m."ord"
      )
      UPDATE "ProductionScheduleOrderAssignment" a SET "csvDashboardRowId" = c."target_id", "updatedAt" = NOW()
      FROM cand c WHERE a."id" = c."row_id"`);

    counts.globalRowRanks += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (m."target_id", r."location") r."id" AS "row_id", m."target_id"
        FROM ${idPairs(o, t)}
        JOIN "ProductionScheduleGlobalRowRank" r ON r."csvDashboardRowId" = m."old_id"
        WHERE NOT EXISTS (
          SELECT 1 FROM "ProductionScheduleGlobalRowRank" x
          WHERE x."csvDashboardRowId" = m."target_id" AND x."location" = r."location"
            AND x."csvDashboardId" = r."csvDashboardId")
        ORDER BY m."target_id", r."location", m."ord"
      )
      UPDATE "ProductionScheduleGlobalRowRank" r SET "csvDashboardRowId" = c."target_id", "updatedAt" = NOW()
      FROM cand c WHERE r."id" = c."row_id"`);

    // 分割は「片の集まり」として扱う。引き継ぎ先に分割が1つも無いときだけ、古い行の分割を(割当ごと)全部移す
    counts.orderSplits += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (m."target_id") m."old_id", m."target_id"
        FROM ${idPairs(o, t)}
        WHERE EXISTS (SELECT 1 FROM "ProductionScheduleOrderSplit" s WHERE s."parentCsvDashboardRowId" = m."old_id")
          AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleOrderSplit" x WHERE x."parentCsvDashboardRowId" = m."target_id")
        ORDER BY m."target_id", m."ord"
      )
      UPDATE "ProductionScheduleOrderSplit" s SET "parentCsvDashboardRowId" = c."target_id", "updatedAt" = NOW()
      FROM cand c WHERE s."parentCsvDashboardRowId" = c."old_id"`);

    counts.progress += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (m."target_id") m."old_id", m."target_id"
        FROM ${idPairs(o, t)}
        WHERE EXISTS (SELECT 1 FROM "ProductionScheduleProgress" p WHERE p."csvDashboardRowId" = m."old_id")
          AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleProgress" x WHERE x."csvDashboardRowId" = m."target_id")
        ORDER BY m."target_id", m."ord"
      )
      UPDATE "ProductionScheduleProgress" p SET "csvDashboardRowId" = c."target_id", "updatedAt" = NOW()
      FROM cand c WHERE p."csvDashboardRowId" = c."old_id"`);

    // 切削の分割: 古い行の4列キー+古い ProductNo のProductionScheduleSessakuPieceSetを、対象行の ProductNo に付け替える。対象の ProductNo に既にあれば移さない
    counts.sessakuPieceSets += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (m."target_id") s."id" AS "row_id", COALESCE(t."rowData"->>'ProductNo', '') AS "target_product_no"
        FROM ${idPairs(o, t)}
        JOIN "CsvDashboardRow" o ON o."id" = m."old_id"
        JOIN "CsvDashboardRow" t ON t."id" = m."target_id"
        JOIN "ProductionScheduleSessakuPieceSet" s ON s."csvDashboardId" = o."csvDashboardId"
          AND s."fseiban" = COALESCE(o."rowData"->>'FSEIBAN', '') AND s."fhincd" = COALESCE(o."rowData"->>'FHINCD', '')
          AND s."fsigencd" = COALESCE(o."rowData"->>'FSIGENCD', '') AND s."fkojun" = COALESCE(o."rowData"->>'FKOJUN', '')
          AND s."productNo" = COALESCE(o."rowData"->>'ProductNo', '')
        WHERE NOT EXISTS (
          SELECT 1 FROM "ProductionScheduleSessakuPieceSet" x
          WHERE x."csvDashboardId" = s."csvDashboardId" AND x."fseiban" = s."fseiban" AND x."fhincd" = s."fhincd"
            AND x."fsigencd" = s."fsigencd" AND x."fkojun" = s."fkojun"
            AND x."productNo" = COALESCE(t."rowData"->>'ProductNo', ''))
        ORDER BY m."target_id", m."ord"
      )
      UPDATE "ProductionScheduleSessakuPieceSet" s SET "productNo" = c."target_product_no", "updatedAt" = NOW()
      FROM cand c WHERE s."id" = c."row_id"`);

    // 切削の分割: 古い行の4列キー+古い ProductNo のProductionScheduleSessakuPieceHistoryを、対象行の ProductNo に付け替える。対象の ProductNo に既にあれば移さない
    counts.sessakuPieceHistories += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (m."target_id") s."id" AS "row_id", COALESCE(t."rowData"->>'ProductNo', '') AS "target_product_no"
        FROM ${idPairs(o, t)}
        JOIN "CsvDashboardRow" o ON o."id" = m."old_id"
        JOIN "CsvDashboardRow" t ON t."id" = m."target_id"
        JOIN "ProductionScheduleSessakuPieceHistory" s ON s."csvDashboardId" = o."csvDashboardId"
          AND s."fseiban" = COALESCE(o."rowData"->>'FSEIBAN', '') AND s."fhincd" = COALESCE(o."rowData"->>'FHINCD', '')
          AND s."fsigencd" = COALESCE(o."rowData"->>'FSIGENCD', '') AND s."fkojun" = COALESCE(o."rowData"->>'FKOJUN', '')
          AND s."productNo" = COALESCE(o."rowData"->>'ProductNo', '')
        WHERE NOT EXISTS (
          SELECT 1 FROM "ProductionScheduleSessakuPieceHistory" x
          WHERE x."csvDashboardId" = s."csvDashboardId" AND x."fseiban" = s."fseiban" AND x."fhincd" = s."fhincd"
            AND x."fsigencd" = s."fsigencd" AND x."fkojun" = s."fkojun"
            AND x."productNo" = COALESCE(t."rowData"->>'ProductNo', ''))
        ORDER BY m."target_id", m."ord"
      )
      UPDATE "ProductionScheduleSessakuPieceHistory" s SET "productNo" = c."target_product_no"
      FROM cand c WHERE s."id" = c."row_id"`);
  }

  // 研削ボードの itemKey(同じキーのままなら書き換え不要)
  const keyPairsList = pairs.filter((p) => p.oldItemKey !== p.targetItemKey);
  for (const batch of chunk(keyPairsList, CHUNK_SIZE)) {
    const ok = batch.map((p) => p.oldItemKey);
    const nk = batch.map((p) => p.targetItemKey);

    counts.grindingOverrides += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (r."siteKey", m."new_key") r."id" AS "row_id", m."new_key"
        FROM ${keyPairs(ok, nk)}
        JOIN "ProductionScheduleGrindingPlanningBoardOverride" r
          ON r."itemKey" = m."old_key" AND r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        WHERE NOT EXISTS (
          SELECT 1 FROM "ProductionScheduleGrindingPlanningBoardOverride" x
          WHERE x."csvDashboardId" = r."csvDashboardId" AND x."siteKey" = r."siteKey" AND x."itemKey" = m."new_key")
        ORDER BY r."siteKey", m."new_key", m."ord"
      )
      UPDATE "ProductionScheduleGrindingPlanningBoardOverride" r SET "itemKey" = c."new_key", "updatedAt" = NOW()
      FROM cand c WHERE r."id" = c."row_id"`);

    counts.grindingArrivals += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (r."siteKey", r."arrivalDate", m."new_key") r."id" AS "row_id", m."new_key"
        FROM ${keyPairs(ok, nk)}
        JOIN "ProductionScheduleGrindingPlanningBoardArrival" r
          ON r."itemKey" = m."old_key" AND r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        WHERE NOT EXISTS (
          SELECT 1 FROM "ProductionScheduleGrindingPlanningBoardArrival" x
          WHERE x."csvDashboardId" = r."csvDashboardId" AND x."siteKey" = r."siteKey"
            AND x."arrivalDate" = r."arrivalDate" AND x."itemKey" = m."new_key")
        ORDER BY r."siteKey", r."arrivalDate", m."new_key", m."ord"
      )
      UPDATE "ProductionScheduleGrindingPlanningBoardArrival" r SET "itemKey" = c."new_key"
      FROM cand c WHERE r."id" = c."row_id"`);

    counts.grindingFirstProcessArrivals += await client.$executeRaw(Prisma.sql`
      WITH cand AS (
        SELECT DISTINCT ON (r."siteKey", m."new_key") r."id" AS "row_id", m."new_key"
        FROM ${keyPairs(ok, nk)}
        JOIN "ProductionScheduleGrindingPlanningBoardFirstProcessArrival" r
          ON r."itemKey" = m."old_key" AND r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        WHERE NOT EXISTS (
          SELECT 1 FROM "ProductionScheduleGrindingPlanningBoardFirstProcessArrival" x
          WHERE x."csvDashboardId" = r."csvDashboardId" AND x."siteKey" = r."siteKey" AND x."itemKey" = m."new_key")
        ORDER BY r."siteKey", m."new_key", m."ord"
      )
      UPDATE "ProductionScheduleGrindingPlanningBoardFirstProcessArrival" r SET "itemKey" = c."new_key"
      FROM cand c WHERE r."id" = c."row_id"`);
  }

  logger.info({ carryOver: counts }, '[SupersededOrderCarryOver] moved data from superseded manufacturing orders to their replacements');
  return counts;
}
