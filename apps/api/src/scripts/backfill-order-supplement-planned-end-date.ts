/**
 * 部品納期個数補助（`ProductionScheduleOrderSupplement`）を補助用 CsvDashboard 行から再同期する。
 * パース拡張やポリシー変更デプロイ後に、既存 `plannedEndDate` の null 化を埋め直す用途で **1 回**実行する想定。
 *
 * ローカル:
 *   pnpm --filter @raspi-system/api backfill:order-supplement-planned-end-date
 *
 * 本番（Pi5 API コンテナ内）:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm backfill:order-supplement-planned-end-date:prod
 */

import { prisma } from '../lib/prisma.js';
import { ProductionScheduleOrderSupplementSyncService } from '../services/production-schedule/order-supplement-sync.service.js';

async function main(): Promise<number> {
  const service = new ProductionScheduleOrderSupplementSyncService();
  const result = await service.syncFromSupplementDashboard();
  console.log('[backfill-order-supplement-planned-end-date] Done:', JSON.stringify(result));
  return 0;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('[backfill-order-supplement-planned-end-date] Error:', err);
    process.exitCode = 1;
  })
  .finally(() =>
    prisma.$disconnect().catch(() => {
      /* ignore */
    })
  );
