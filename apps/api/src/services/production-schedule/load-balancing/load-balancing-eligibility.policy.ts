import { Prisma } from '@prisma/client';

import { buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql } from '../completion/fkojunst-mail-status-completion.policy.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule-effective-completion.sql.js';

/**
 * キオスク負荷調整（資源CD俯瞰・機種別月次・着手日・外注・社内移管）の行母集団。
 * - FKOJUNST_Status の厳密一致が完了コード C/X 以外、または保存済みの未完了の付け替え先あり
 * - 実効未完了（手動完了・外部完了を除外）
 *
 * 前提 JOIN: `fkmail`, `p` (ProductionScheduleProgress), `ext` (ProductionScheduleExternalCompletion)
 */
export function buildLoadBalancingRowEligibilityWhereSql(): Prisma.Sql {
  return Prisma.sql`
    AND (
      ("fkmail"."id" IS NOT NULL AND ${buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql()})
      OR "ext"."loadResourceCdFromFkojunstResourceSwap" IS NOT NULL
    )
    AND ${buildProductionScheduleEffectiveCompletedSql()} = FALSE
  `;
}
