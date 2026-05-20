import { Prisma } from '@prisma/client';

import { buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql } from '../completion/fkojunst-mail-status-completion.policy.js';

/** キオスク生産日程一覧で表示する FKOJUNST_Status コード（`fkmail` 正本）。 */
export const FKOJUNST_MAIL_KIOSK_LIST_VISIBLE_STATUS_CODES = ['S', 'R', 'C', 'X'] as const;

/**
 * 生産日程 winner 行の一覧で、工順ST（FKOJUNST）表示の根拠を決める式（SQL 断片）。
 * **正本は FKOJUNST_Status 同期（`fkmail`）のみ**。旧 Gmail FKOJUNST 行（`fkst`）は参照しない。
 */
export function buildFkojunstProductionScheduleListVisibleScalarSql(): Prisma.Sql {
  return Prisma.sql`(
    "fkmail"."id" IS NOT NULL
    AND UPPER(BTRIM("fkmail"."statusCode")) IN (${Prisma.join(
      FKOJUNST_MAIL_KIOSK_LIST_VISIBLE_STATUS_CODES.map((c) => Prisma.sql`${c}`),
      ', '
    )})
  )`;
}

export function buildFkojunstProductionScheduleListRowDataFkojunstSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${buildFkojunstProductionScheduleListVisibleScalarSql()} THEN "fkmail"."statusCode"
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
  return Prisma.sql`AND ${buildFkojunstProductionScheduleListVisibleScalarSql()}`;
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
