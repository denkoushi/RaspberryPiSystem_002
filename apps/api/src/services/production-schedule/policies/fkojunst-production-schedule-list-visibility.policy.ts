import { Prisma } from '@prisma/client';

/**
 * 生産日程 winner 行の一覧で、工順ST（FKOJUNST）表示の根拠を決める式（SQL 断片）。
 * **正本は FKOJUNST_Status 同期（`fkmail`）のみ**。旧 Gmail FKOJUNST 行（`fkst`）は参照しない。
 */
export function buildFkojunstProductionScheduleListRowDataFkojunstSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN "fkmail"."id" IS NOT NULL AND "fkmail"."statusCode" IN ('S', 'R') THEN "fkmail"."statusCode"
      ELSE ''
    END
  `;
}

/**
 * 一覧 COUNT / 明細で同一の可視性条件。
 * - `fkmail` がある、かつ `S` / `R` のときのみ表示
 * - `fkmail` が無い、または `S` / `R` 以外は除外
 */
export function buildFkojunstProductionScheduleListVisibilityWhereSql(): Prisma.Sql {
  return Prisma.sql`AND "fkmail"."id" IS NOT NULL AND "fkmail"."statusCode" IN ('S', 'R')`;
}

/**
 * 生産日程CSV「消滅」判定を適用する winner かどうか。
 * 一覧可視条件と同義で、`fkmail` が `S` / `R` の winner にのみ適用する。
 */
export function buildFkojunstScheduleCsvDisappearanceEligibleScalarSql(): Prisma.Sql {
  return Prisma.sql`("fkmail"."id" IS NOT NULL AND "fkmail"."statusCode" IN ('S', 'R'))`;
}
