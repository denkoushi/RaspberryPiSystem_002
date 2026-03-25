import type { FastifyInstance } from 'fastify';
import { registerSystemRoutes } from './system/index.js';
import { registerAuthRoutes } from './auth.js';
import { registerToolsRoutes } from './tools/index.js';
import { registerClientRoutes } from './clients/index.js';
import { registerKioskRoutes } from './kiosk/index.js';
import { registerImportRoutes } from './imports.js';
import { registerStorageRoutes } from './storage/index.js';
import { registerSignageRoutes } from './signage/index.js';
import { registerMeasuringInstrumentRoutes } from './measuring-instruments/index.js';
import { registerRiggingRoutes } from './rigging/index.js';
import { registerBackupRoutes } from './backup.js';
import { registerGmailOAuthRoutes } from './gmail/oauth.js';
import { registerGmailConfigRoutes } from './gmail/config.js';
import { registerWebRTCRoutes } from './webrtc/index.js';
import { registerCsvDashboardRoutes } from './csv-dashboards/index.js';
import { registerCsvImportSubjectPatternRoutes } from './csv-import-subject-patterns.js';
import { registerCsvImportConfigRoutes } from './csv-import-configs.js';
import { registerVisualizationRoutes } from './visualizations/index.js';
import { registerProductionScheduleSettingsRoutes } from './production-schedule-settings.js';
import { registerKioskDocumentRoutes } from './kiosk-documents.js';

/**
 * すべてのルートを登録
 *
 * 注記: レート制限プラグインの登録は `app.ts` 側で一元実施する。
 * ルート単位で無効化が必要な場合のみ、各ハンドラで `config.rateLimit = false` を使う。
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (subApp) => {
      await registerSystemRoutes(subApp);
      await registerAuthRoutes(subApp);
      
      // ツール管理モジュール（パス: /api/tools/*）
      await registerToolsRoutes(subApp);
      // 計測機器管理モジュール（パス: /api/measuring-instruments/*）
      await registerMeasuringInstrumentRoutes(subApp);
      // 吊具管理モジュール（パス: /api/rigging-gears/*）
      await registerRiggingRoutes(subApp);
      
      await registerClientRoutes(subApp);
      await registerKioskRoutes(subApp);
      registerKioskDocumentRoutes(subApp);
      await registerImportRoutes(subApp);
      await registerStorageRoutes(subApp);
      await registerSignageRoutes(subApp);
      await registerBackupRoutes(subApp);
      // Gmail OAuth認証ルート
      registerGmailOAuthRoutes(subApp);
      // Gmail設定管理ルート
      registerGmailConfigRoutes(subApp);
      // WebRTCシグナリングルート
      await registerWebRTCRoutes(subApp);
      // CSVダッシュボード管理ルート
      registerCsvDashboardRoutes(subApp);
      // 可視化ダッシュボード管理ルート
      registerVisualizationRoutes(subApp);
      // CSVインポート件名パターン管理ルート
      registerCsvImportSubjectPatternRoutes(subApp);
      // CSVインポート設定管理ルート（マスターデータ）
      registerCsvImportConfigRoutes(subApp);
      // 生産スケジュール設定管理ルート
      registerProductionScheduleSettingsRoutes(subApp);
    },
    { prefix: '/api' },
  );
}
