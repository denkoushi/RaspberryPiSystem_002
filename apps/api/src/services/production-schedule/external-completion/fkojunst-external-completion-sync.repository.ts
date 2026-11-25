import { acquireSessakuPieceBoardStateLocks, encodeSessakuPieceKey, findSessakuPieceWinner } from '../sessaku-pieces/piece-key.js';
import { lockAllSessakuPieceSets, synchronizeSessakuPieceSources } from '../sessaku-pieces/piece-sync.js';
import { Prisma, type PrismaClient } from '@prisma/client';

import { buildFkojunstMailStatusCompletedScalarSql } from '../completion/fkojunst-mail-status-completion.policy.js';
import {
  FKOJUNST_RESOURCE_SWAP_COMPLETE_STATUS,
  FKOJUNST_RESOURCE_SWAP_OWN_BLOCKING_STATUS,
} from '../completion/fkojunst-resource-swap-completion.policy.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../constants.js';
import { getResourceCategoryPolicy, SHARED_RESOURCE_CATEGORY_LOCATION } from '../policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

export type PrismaExecutor = Pick<PrismaClient, '$executeRaw'>;

const winnersBaseSql = () => Prisma.sql`
  SELECT
    "cdr"."id" AS "id",
    BTRIM("cdr"."rowData"->>'ProductNo') AS "productNo",
    BTRIM("cdr"."rowData"->>'FKOJUN') AS "fkojun",
    UPPER(BTRIM("cdr"."rowData"->>'FSIGENCD')) AS "resourceCd",
    "fkmail"."statusCode" AS "ownStatusCode",
    CASE WHEN NOT "fkmail"."hasUnparseableDate" THEN "fkmail"."sourceUpdatedAt" END AS "ownUpdatedAt",
    ${buildFkojunstMailStatusCompletedScalarSql()} AS "mailStatusComplete"
  FROM "CsvDashboardRow" AS "cdr"
  LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
    ON "fkmail"."csvDashboardRowId" = "cdr"."id"
    AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  WHERE "cdr"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND ${buildMaxProductNoWinnerCondition('cdr')}
`;

const existingResourceSwapCompletionsSql = () => Prisma.sql`
  SELECT "ext"."csvDashboardRowId" AS "id",
    "ext"."externallyCompletedFromFkojunstMailStatus" AS "mailStatusComplete",
    FALSE AS "resourceSwapComplete"
  FROM "ProductionScheduleExternalCompletion" "ext"
  WHERE "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND "ext"."externallyCompletedFromFkojunstResourceSwap"
`;

function winnerCompletionCtes(excludedResourceCds: string[]): Prisma.Sql {
  return Prisma.sql`
    "winners" AS MATERIALIZED (
      ${winnersBaseSql()}
    ),
    "singleWinnerProcesses" AS (
      SELECT "productNo", "fkojun"
      FROM "winners"
      -- 除外資源(10、組立など)の行は同じ工順に並んでも数えない(KB-456 の本番データ)。
      WHERE "productNo" <> '' AND "fkojun" <> ''
        AND "resourceCd" <> ALL(${excludedResourceCds}::text[])
      GROUP BY "productNo", "fkojun"
      HAVING COUNT(*) = 1
    ),
    "resourceSwapCompletions" AS (
      SELECT "w"."id"
      FROM "singleWinnerProcesses" "single"
      JOIN "winners" "w" USING ("productNo", "fkojun")
      JOIN "ProductionScheduleFkojunstResourceSwapEvidence" "e"
        ON "e"."sourceCsvDashboardId" = ${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}
        AND "e"."productNo" = "w"."productNo" AND "e"."fkojun" = "w"."fkojun"
        AND "e"."resourceCd" <> "w"."resourceCd"
      WHERE "w"."resourceCd" <> ''
        AND "w"."resourceCd" <> ALL(${excludedResourceCds}::text[])
      GROUP BY "w"."id"
      -- 非 C、除外資源、FUPDTEDT 不明も別資源の件数には含める。
      HAVING COUNT(*) = 1 AND BOOL_AND(
        "e"."statusCode" = ${FKOJUNST_RESOURCE_SWAP_COMPLETE_STATUS}
        AND "e"."resourceCd" <> ALL(${excludedResourceCds}::text[])
        AND "e"."sourceUpdatedAt" IS NOT NULL
        AND ("w"."ownStatusCode" IS NULL OR (
          "w"."ownStatusCode" <> ${FKOJUNST_RESOURCE_SWAP_OWN_BLOCKING_STATUS}
          AND "w"."ownUpdatedAt" IS NOT NULL
          AND "e"."sourceUpdatedAt" >= "w"."ownUpdatedAt"
        ))
      )
    ),
    "completionSources" AS (
      SELECT "w"."id", "w"."mailStatusComplete", "swap"."id" IS NOT NULL AS "resourceSwapComplete"
      FROM "winners" "w"
      LEFT JOIN "resourceSwapCompletions" "swap" ON "swap"."id" = "w"."id"
      UNION ALL
      ${existingResourceSwapCompletionsSql()}
        AND NOT EXISTS (SELECT 1 FROM "winners" "w" WHERE "w"."id" = "ext"."csvDashboardRowId")
    )
  `;
}

/**
 * FKOJUNST_Status の厳密一致 C/X と、付け替え先の C を外部完了に反映する。
 * 旧「メール dedupe キー消失」と生産日程CSV消滅完了は完了正本から外し、互換列は false に収束させる。
 */
export async function replaceAllWinnerExternalCompletionStatesFromMailSync(
  executor: Prisma.TransactionClient,
  mailCriticalLocked = false,
  mode: 'recompute' | 'clear-resource-swap' = 'recompute'
): Promise<number> {
  const completionCtes = mode === 'clear-resource-swap'
    ? Prisma.sql`"completionSources" AS (${existingResourceSwapCompletionsSql()})`
    : winnerCompletionCtes((await getResourceCategoryPolicy({ siteKey: SHARED_RESOURCE_CATEGORY_LOCATION }, executor)).cuttingExcludedResourceCds);
  const sets = await lockAllSessakuPieceSets(executor, mailCriticalLocked);
  if (sets.some((set) => set.pieces.length)) await acquireSessakuPieceBoardStateLocks(executor);
  // この transaction は CsvDashboardRow を書き換えないので、片の winner は前後で変わらない。
  const winnerIdBySetKey = new Map<string, string | null>();
  const previous = new Map<string, boolean>();
  for (const set of sets) {
    const winner = await findSessakuPieceWinner(executor, set);
    const external = winner && await executor.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: winner.id } });
    winnerIdBySetKey.set(encodeSessakuPieceKey(set), winner?.id ?? null);
    previous.set(encodeSessakuPieceKey(set), external?.isExternallyCompleted === true);
  }
  // 値が変わる行だけを書く。全 winner（約10万行）を毎回書き直すと WAL が膨らみ、
  // 書き込みの遅い時間帯に transaction が timeout する（2026-11-13 の生産日程2通目）。
  const written = await executor.$executeRaw`
    WITH ${completionCtes},
    "computed" AS (
      SELECT
        "completionSources".*,
        "mailStatusComplete" OR "resourceSwapComplete" AS "isExternallyCompleted"
      FROM "completionSources"
    ),
    "pending" AS (
      SELECT "c".*
      FROM "computed" "c"
      LEFT JOIN "ProductionScheduleExternalCompletion" AS "existing"
        ON "existing"."csvDashboardRowId" = "c"."id"
      WHERE "existing"."csvDashboardRowId" IS NULL
        OR "existing"."isExternallyCompleted" IS DISTINCT FROM "c"."isExternallyCompleted"
        OR "existing"."externallyCompletedFromFkojunstMailStatus" IS DISTINCT FROM "c"."mailStatusComplete"
        OR "existing"."externallyCompletedFromFkojunstResourceSwap" IS DISTINCT FROM "c"."resourceSwapComplete"
        OR "existing"."externallyCompletedFromFkojunstDisappeared" IS DISTINCT FROM FALSE
        OR "existing"."externallyCompletedFromScheduleCsvDisappeared" IS DISTINCT FROM FALSE
    )
    INSERT INTO "ProductionScheduleExternalCompletion" (
      "csvDashboardRowId",
      "csvDashboardId",
      "isExternallyCompleted",
      "externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromFkojunstResourceSwap",
      "externallyCompletedFromScheduleCsvDisappeared",
      "createdAt",
      "updatedAt"
    )
    SELECT
      "c"."id",
      ${PRODUCTION_SCHEDULE_DASHBOARD_ID},
      "c"."isExternallyCompleted",
      FALSE,
      "c"."mailStatusComplete",
      "c"."resourceSwapComplete",
      FALSE,
      NOW(),
      NOW()
    FROM "pending" "c"
    ON CONFLICT ("csvDashboardRowId") DO UPDATE SET
      "externallyCompletedFromFkojunstDisappeared" = EXCLUDED."externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus" = EXCLUDED."externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromFkojunstResourceSwap" = EXCLUDED."externallyCompletedFromFkojunstResourceSwap",
      "externallyCompletedFromScheduleCsvDisappeared" = FALSE,
      "isExternallyCompleted" = EXCLUDED."isExternallyCompleted",
      "updatedAt" = NOW()
    WHERE "ProductionScheduleExternalCompletion"."isExternallyCompleted" IS DISTINCT FROM EXCLUDED."isExternallyCompleted"
      OR "ProductionScheduleExternalCompletion"."externallyCompletedFromFkojunstMailStatus" IS DISTINCT FROM EXCLUDED."externallyCompletedFromFkojunstMailStatus"
      OR "ProductionScheduleExternalCompletion"."externallyCompletedFromFkojunstResourceSwap" IS DISTINCT FROM EXCLUDED."externallyCompletedFromFkojunstResourceSwap"
      OR "ProductionScheduleExternalCompletion"."externallyCompletedFromFkojunstDisappeared" IS DISTINCT FROM EXCLUDED."externallyCompletedFromFkojunstDisappeared"
      OR "ProductionScheduleExternalCompletion"."externallyCompletedFromScheduleCsvDisappeared" IS DISTINCT FROM FALSE
  `;
  const winnerIds = [...new Set([...winnerIdBySetKey.values()].filter((id): id is string => id !== null))];
  const currentByWinnerId = new Map(
    (winnerIds.length
      ? await executor.productionScheduleExternalCompletion.findMany({
          where: { csvDashboardRowId: { in: winnerIds } },
          select: { csvDashboardRowId: true, isExternallyCompleted: true },
        })
      : []
    ).map((row) => [row.csvDashboardRowId, row.isExternallyCompleted === true])
  );
  const changed = new Set<string>();
  for (const set of sets) {
    const key = encodeSessakuPieceKey(set);
    const winnerId = winnerIdBySetKey.get(key) ?? null;
    const current = winnerId ? currentByWinnerId.get(winnerId) === true : false;
    if (previous.get(key) !== current) changed.add(key);
  }
  await synchronizeSessakuPieceSources(executor, sets, changed);
  return written;
}

/**
 * 生産日程CSV消滅完了は廃止済み。
 *
 * 互換呼び出しが残っても、差分消失キーは完了に使わず、FKOJUNST_Status 由来の外部完了を再計算する。
 */
export async function replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync(
  executor: Prisma.TransactionClient,
  disappearedScheduleKeys: readonly string[]
): Promise<void> {
  void disappearedScheduleKeys;
  await replaceAllWinnerExternalCompletionStatesFromMailSync(executor);
}

/**
 * @deprecated 呼び出し側は {@link replaceAllWinnerExternalCompletionStatesFromMailSync} を明示利用する。
 * 互換のためメール同期と同じ処理とする。
 */
export async function replaceAllWinnerExternalCompletionStates(
  executor: Prisma.TransactionClient
): Promise<void> {
  await replaceAllWinnerExternalCompletionStatesFromMailSync(executor);
}
