import { Prisma } from '@prisma/client';

import type { prisma as prismaSingleton } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  buildMaxProductNoLogicalKeyPartitionExprs,
  buildMaxProductNoWinnerSelectionOrderBySql,
  quoteSqlIdentifierOrThrow,
} from './max-product-no-winner-spec.js';

export type PrismaClientLike = Pick<typeof prismaSingleton, '$queryRaw'>;

/**
 * 単一 CSV ダッシュボードについて、`buildMaxProductNoWinnerCondition` と同値の winner 行 id を一覧取得する。
 *（相関サブクエリより先にウィンドウ集約へ畳んで DB 評価回数を減らす）
 */
export async function fetchMaxProductNoWinnerRowIdsForDashboard(params: {
  prisma: PrismaClientLike;
  csvDashboardId: string;
}): Promise<string[]> {
  const partitionExprs = buildMaxProductNoLogicalKeyPartitionExprs('r');
  const winnerOrderBy = buildMaxProductNoWinnerSelectionOrderBySql('r');

  const rows = await params.prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      WITH ranked AS (
        SELECT
          "r"."id",
          ROW_NUMBER() OVER (
            PARTITION BY ${Prisma.raw(partitionExprs)}
            ORDER BY ${Prisma.raw(winnerOrderBy)}
          ) AS "rn"
        FROM "CsvDashboardRow" AS "r"
        WHERE "r"."csvDashboardId" = ${params.csvDashboardId}
      )
      SELECT "id"::text FROM ranked WHERE "rn" = 1
    `
  );

  return rows.map((r) => r.id);
}

/**
 * 「外側別名の id が materialized winner 集合に含まれる」WHERE 断片。
 * `winnerRowIds` が空のときは常に偽（相関 winner が存在しないダッシュボードと同義）。
 */
export function buildMaterializedMaxProductNoWinnerInCondition(
  rowAlias: string,
  winnerRowIds: readonly string[]
): Prisma.Sql {
  if (winnerRowIds.length === 0) {
    return Prisma.sql`FALSE`;
  }
  const q = quoteSqlIdentifierOrThrow(rowAlias);
  return Prisma.sql`${Prisma.raw(`${q}."id"`)} IN (${Prisma.join(
    winnerRowIds.map((id) => Prisma.sql`${id}`),
    ', '
  )})`;
}

/**
 * leaderboard-shell / leaderboard responseProfile で共通利用するベース WHERE。
 * （`CsvDashboardRow` に限定した dashboard + winner IN）
 */
export function buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
  csvDashboardId: string,
  winnerRowIds: readonly string[]
): Prisma.Sql {
  return Prisma.sql`
    "CsvDashboardRow"."csvDashboardId" = ${csvDashboardId}
    AND ${buildMaterializedMaxProductNoWinnerInCondition('CsvDashboardRow', winnerRowIds)}
  `;
}

/**
 * 順位ボード（shell / hydrate / responseProfile=leaderboard）が共有する WINNER 済み baseWhere を 1 query で確定する。
 */
export async function buildProductionScheduleLeaderboardMaterializedBaseWhere(
  prisma: PrismaClientLike
): Promise<Prisma.Sql> {
  const winnerRowIds = await fetchMaxProductNoWinnerRowIdsForDashboard({
    prisma,
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
  });
  return buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
    PRODUCTION_SCHEDULE_DASHBOARD_ID,
    winnerRowIds
  );
}
