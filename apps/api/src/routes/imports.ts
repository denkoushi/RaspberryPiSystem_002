import type { FastifyInstance } from 'fastify';

import { registerImportMasterRoutes } from './imports/master.js';
import { registerImportScheduleRoutes } from './imports/schedule.js';
import { registerImportHistoryRoutes } from './imports/history.js';

/**
 * CSVインポート関連ルートを登録
 *
 * 役割:
 * - route module の集約登録のみを担当
 * - 実処理は各 route module / service へ委譲
 */
export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  await registerImportMasterRoutes(app);
  await registerImportScheduleRoutes(app);
  await registerImportHistoryRoutes(app);
}

// 後方互換性のため、processCsvImportとprocessCsvImportFromTargetsを再エクスポート
export { processCsvImport, processCsvImportFromTargets } from '../services/imports/csv-import-process.service.js';
