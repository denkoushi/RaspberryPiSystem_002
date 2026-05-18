import { Prisma } from '@prisma/client';

/**
 * FKOJUNST_Status メール同期（`ProductionScheduleFkojunstMailStatus`）の status 解釈の正本。
 * - **C / X**: 外部完了（`ProductionScheduleExternalCompletion` のメール由来フラグ）
 * - **S / R**: 一覧表示・未完了
 * - **O / P**: 一覧非表示・未完了（製番進捗などの total には残る）
 *
 * 一覧の FKOJUNST 列・可視条件は {@link ../policies/fkojunst-production-schedule-list-visibility.policy.js}。
 * SQL の IN 句は本モジュールの定数と同期すること。
 */
export const FKOJUNST_MAIL_COMPLETED_STATUS_CODES = ['C', 'X'] as const;

export type FkojunstMailCompletedStatusCode = (typeof FKOJUNST_MAIL_COMPLETED_STATUS_CODES)[number];

export const FKOJUNST_MAIL_LIST_VISIBLE_STATUS_CODES = ['S', 'R'] as const;

export const FKOJUNST_MAIL_HIDDEN_INCOMPLETE_STATUS_CODES = ['O', 'P'] as const;

/**
 * `winnersBaseSql` などで `fkmail` エイリアスが付いた JOIN に対し、メール status 完了スカラーを返す。
 */
export function buildFkojunstMailStatusCompletedScalarSql(): Prisma.Sql {
  return Prisma.sql`COALESCE((UPPER(BTRIM("fkmail"."statusCode")) IN (${Prisma.join(
    FKOJUNST_MAIL_COMPLETED_STATUS_CODES.map((c) => Prisma.sql`${c}`),
    ', '
  )})), FALSE)`;
}

/**
 * 生産日程CSV「消滅」母集団に含める `fkmail` 行か（メール由来完了 **C / X 以外**）。
 * `fkmail` JOIN 済み・エイリアス `fkmail` 前提。{@link buildFkojunstMailStatusCompletedScalarSql} と同じ正規化で判定する。
 */
export function buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql(): Prisma.Sql {
  return Prisma.sql`("fkmail"."statusCode" IS NOT NULL AND NOT COALESCE((UPPER(BTRIM("fkmail"."statusCode")) IN (${Prisma.join(
    FKOJUNST_MAIL_COMPLETED_STATUS_CODES.map((c) => Prisma.sql`${c}`),
    ', '
  )})), FALSE))`;
}
