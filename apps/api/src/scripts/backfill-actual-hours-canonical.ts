/**
 * 実績工数 Canonical / Feature のバックフィルスクリプト
 *
 * 既存の ProductionScheduleActualHoursRaw から Canonical を再構築し、
 * 続けて Feature を再集約する。Deploy 後に本番DBへ既存Rawを反映する際に使用する。
 *
 * 使い方:
 *   pnpm --filter @raspi-system/api backfill:actual-hours
 *   ACTUAL_HOURS_LOCATION_KEY=default pnpm --filter @raspi-system/api backfill:actual-hours
 *
 * Docker コンテナ内で実行する場合:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm backfill:actual-hours:prod
 */

import { ActualHoursImportOrchestratorService } from '../services/production-schedule/actual-hours/actual-hours-import-orchestrator.service.js';

const locationKey = process.env.ACTUAL_HOURS_LOCATION_KEY?.trim() || 'default';

async function main() {
  const orchestrator = new ActualHoursImportOrchestratorService();
  console.log(`[backfill-actual-hours] locationKey=${locationKey}`);

  const canonicalResult = await orchestrator.rebuildCanonical({ locationKey });
  console.log('[backfill-actual-hours] Canonical rebuild:', canonicalResult);

  const featureResult = await orchestrator.rebuildFeatures({ locationKey });
  console.log('[backfill-actual-hours] Feature rebuild:', featureResult);

  console.log('[backfill-actual-hours] Done.');
}

main().catch((err) => {
  console.error('[backfill-actual-hours] Error:', err);
  process.exit(1);
});
