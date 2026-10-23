#!/usr/bin/env node
/**
 * CSVダッシュボードの古い行の削除を試運転する（件数を数えるだけで、何も消さない）
 *
 * 使用方法:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec api node dist/scripts/csv-dashboard-retention-dry-run.js
 */
import { CsvDashboardService } from '../services/csv-dashboard/csv-dashboard.service.js';

async function main() {
  const result = await new CsvDashboardService().cleanupOldData({ dryRun: true });
  console.log(JSON.stringify(result));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
