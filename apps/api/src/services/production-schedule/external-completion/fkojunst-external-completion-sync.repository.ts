import { acquireSessakuPieceBoardStateLocks, encodeSessakuPieceKey, findSessakuPieceWinner } from '../sessaku-pieces/piece-key.js';
import { lockAllSessakuPieceSets, synchronizeSessakuPieceSources } from '../sessaku-pieces/piece-sync.js';
import { Prisma, type PrismaClient } from '@prisma/client';

import { buildFkojunstMailStatusCompletedScalarSql } from '../completion/fkojunst-mail-status-completion.policy.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

export type PrismaExecutor = Pick<PrismaClient, '$executeRaw'>;

const winnersBaseSql = () => Prisma.sql`
  SELECT
    "cdr"."id" AS "id",
    ${buildFkojunstMailStatusCompletedScalarSql()} AS "mailStatusComplete"
  FROM "CsvDashboardRow" AS "cdr"
  LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
    ON "fkmail"."csvDashboardRowId" = "cdr"."id"
    AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  WHERE "cdr"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND ${buildMaxProductNoWinnerCondition('cdr')}
`;

/**
 * FKOJUNST_Status メール同期後: `fkmail` の **C/X** だけを外部完了に反映する。
 * 旧「メール dedupe キー消失」と生産日程CSV消滅完了は完了正本から外し、互換列は false に収束させる。
 */
export async function replaceAllWinnerExternalCompletionStatesFromMailSync(executor: Prisma.TransactionClient, mailCriticalLocked = false): Promise<number> {
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
    WITH "winners" AS (
      ${winnersBaseSql()}
    ),
    "computed" AS (
      SELECT
        "w"."id",
        FALSE AS "mailDisappeared",
        "w"."mailStatusComplete" AS "mailStatusComplete"
      FROM "winners" "w"
    ),
    "pending" AS (
      SELECT "c".*
      FROM "computed" "c"
      LEFT JOIN "ProductionScheduleExternalCompletion" AS "existing"
        ON "existing"."csvDashboardRowId" = "c"."id"
      WHERE "existing"."csvDashboardRowId" IS NULL
        OR "existing"."isExternallyCompleted" IS DISTINCT FROM "c"."mailStatusComplete"
        OR "existing"."externallyCompletedFromFkojunstMailStatus" IS DISTINCT FROM "c"."mailStatusComplete"
        OR "existing"."externallyCompletedFromFkojunstDisappeared" IS DISTINCT FROM "c"."mailDisappeared"
        OR "existing"."externallyCompletedFromScheduleCsvDisappeared" IS DISTINCT FROM FALSE
    )
    INSERT INTO "ProductionScheduleExternalCompletion" (
      "csvDashboardRowId",
      "csvDashboardId",
      "isExternallyCompleted",
      "externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromScheduleCsvDisappeared",
      "createdAt",
      "updatedAt"
    )
    SELECT
      "c"."id",
      ${PRODUCTION_SCHEDULE_DASHBOARD_ID},
      "c"."mailStatusComplete",
      "c"."mailDisappeared",
      "c"."mailStatusComplete",
      FALSE,
      NOW(),
      NOW()
    FROM "pending" "c"
    ON CONFLICT ("csvDashboardRowId") DO UPDATE SET
      "externallyCompletedFromFkojunstDisappeared" = EXCLUDED."externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus" = EXCLUDED."externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromScheduleCsvDisappeared" = FALSE,
      "isExternallyCompleted" = EXCLUDED."externallyCompletedFromFkojunstMailStatus",
      "updatedAt" = NOW()
    WHERE "ProductionScheduleExternalCompletion"."isExternallyCompleted" IS DISTINCT FROM EXCLUDED."externallyCompletedFromFkojunstMailStatus"
      OR "ProductionScheduleExternalCompletion"."externallyCompletedFromFkojunstMailStatus" IS DISTINCT FROM EXCLUDED."externallyCompletedFromFkojunstMailStatus"
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
 * 互換呼び出しが残っても、差分消失キーは完了に使わず、外部完了を FKOJUNST_Status C/X のみに収束させる。
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
