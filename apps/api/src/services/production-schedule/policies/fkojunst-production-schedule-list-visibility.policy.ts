import { Prisma } from '@prisma/client';

import { buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql } from '../completion/fkojunst-mail-status-completion.policy.js';

/**
 * 生産日程 winner 行の一覧で、工順ST（FKOJUNST）表示の根拠を決める式（SQL 断片）。
 * **正本は FKOJUNST_Status 同期（`fkmail`）のみ**。旧 Gmail FKOJUNST 行（`fkst`）は参照しない。
 */
export function buildFkojunstProductionScheduleListRowDataFkojunstSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN "fkmail"."id" IS NOT NULL AND "fkmail"."statusCode" IN ('S', 'R', 'C', 'X') THEN "fkmail"."statusCode"
      ELSE ''
    END
  `;
}

/**
 * 一覧 COUNT / 明細で同一の可視性条件。
 * - `fkmail` がある、かつ `S` / `R` / `C` / `X` のとき表示
 * - `fkmail` が無い、または `O` / `P` 等は除外
 */
export function buildFkojunstProductionScheduleListVisibilityWhereSql(): Prisma.Sql {
  return Prisma.sql`AND "fkmail"."id" IS NOT NULL AND "fkmail"."statusCode" IN ('S', 'R', 'C', 'X')`;
}

/**
 * 生産日程CSV「消滅」判定を適用する winner かどうか。
 * `FKOJUNST_Status` 同期済みで、かつ **メール由来完了（`C` / `X`）以外** の winner に適用する。
 * （完了コードは {@link ../completion/fkojunst-mail-status-completion.policy.js} の正本に従う）
 * 一覧の可視性（S/R/C/X）とは別条件。
 */
export function buildFkojunstScheduleCsvDisappearanceEligibleScalarSql(): Prisma.Sql {
  return Prisma.sql`("fkmail"."id" IS NOT NULL AND ${buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql()})`;
}
