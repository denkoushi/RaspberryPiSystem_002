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
export async function replaceAllWinnerExternalCompletionStatesFromMailSync(executor: Prisma.TransactionClient, mailCriticalLocked = false): Promise<void> {
  const sets = await lockAllSessakuPieceSets(executor, mailCriticalLocked);
  if (sets.some((set) => set.pieces.length)) await acquireSessakuPieceBoardStateLocks(executor);
  const previous = new Map<string, boolean>();
  for (const set of sets) {
    const winner = await findSessakuPieceWinner(executor, set);
    const external = winner && await executor.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: winner.id } });
    previous.set(encodeSessakuPieceKey(set), external?.isExternallyCompleted === true);
  }
  await executor.$executeRaw`
    WITH "winners" AS (
      ${winnersBaseSql()}
    ),
    "computed" AS (
      SELECT
        "w"."id",
        FALSE AS "mailDisappeared",
        "w"."mailStatusComplete" AS "mailStatusComplete"
      FROM "winners" "w"
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
    FROM "computed" "c"
    ON CONFLICT ("csvDashboardRowId") DO UPDATE SET
      "externallyCompletedFromFkojunstDisappeared" = EXCLUDED."externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus" = EXCLUDED."externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromScheduleCsvDisappeared" = FALSE,
      "isExternallyCompleted" = EXCLUDED."externallyCompletedFromFkojunstMailStatus",
      "updatedAt" = NOW()
  `;
  const changed = new Set<string>();
  for (const set of sets) {
    const winner = await findSessakuPieceWinner(executor, set);
    const external = winner && await executor.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: winner.id } });
    if (previous.get(encodeSessakuPieceKey(set)) !== (external?.isExternallyCompleted === true)) changed.add(encodeSessakuPieceKey(set));
  }
  await synchronizeSessakuPieceSources(executor, sets, changed);
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
