import { Prisma } from '@prisma/client';

/**
 * 生産日程 winner 行の一覧で、工順ST（FKOJUNST）表示の根拠を決める式（SQL 断片）。
 * - FKOJUNST_Status 同期（fkmail）が S/R のときはメールを優先
 * - それ以外は従来どおり fkst（Gmail FKOJUNST ルート同期）
 */
export function buildFkojunstProductionScheduleListRowDataFkojunstSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN "fkmail"."id" IS NOT NULL AND "fkmail"."statusCode" IN ('S', 'R') THEN "fkmail"."statusCode"
      ELSE COALESCE("fkst"."statusCode", '')
    END
  `;
}

/**
 * 一覧 COUNT / 明細で同一の可視性条件。
 * - fkmail 行があるのに S/R 以外 → 除外（fkst へはフォールバックしない）
 * - fkmail 無し → fkst が S/R の行だけ残す（NULL・空は S/R 以外扱い）
 */
export function buildFkojunstProductionScheduleListVisibilityWhereSql(): Prisma.Sql {
  return Prisma.sql`
    AND NOT (
      ("fkmail"."id" IS NOT NULL AND "fkmail"."statusCode" NOT IN ('S', 'R'))
      OR ("fkmail"."id" IS NULL AND COALESCE("fkst"."statusCode", '') NOT IN ('S', 'R'))
    )
  `;
}
