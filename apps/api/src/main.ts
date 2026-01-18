import { buildServer } from './app.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';
import { getBackupScheduler } from './services/backup/backup-scheduler.js';
import { getCsvImportScheduler } from './services/imports/csv-import-scheduler.js';
import { getAlertsDispatcher } from './services/alerts/alerts-dispatcher.js';
import { getAlertsIngestor } from './services/alerts/alerts-ingestor.js';

if (process.env['NODE_ENV'] !== 'test') {
  buildServer()
    .then(async (app) => {
      await app.listen({ port: env.PORT, host: env.HOST });
      logger.info({ address: `http://${env.HOST}:${env.PORT}` }, 'API server listening');
      
      // サイネージレンダリングの定期実行を開始（app.tsで作成されたスケジューラーを使用）
      app.signageRenderScheduler.start();
      
      logger.info({ intervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS }, 'Signage render scheduler started');
      
      // バックアップスケジューラーを開始
      const backupScheduler = getBackupScheduler();
      await backupScheduler.start();
      
      logger.info('Backup scheduler started');
      
      // CSVインポートスケジューラーを開始
      const csvImportScheduler = getCsvImportScheduler();
      await csvImportScheduler.start();
      
      logger.info('CSV import scheduler started');

      // Alerts dispatcher を開始（alertsファイル -> Slack配送）
      // NOTE: デフォルト無効。ALERTS_DISPATCHER_ENABLED=true の場合のみ動作。
      const alertsDispatcher = getAlertsDispatcher();
      await alertsDispatcher.start();

      // Alerts ingestor を開始（alertsファイル -> DB取り込み）
      // NOTE: デフォルト無効。ALERTS_DB_INGEST_ENABLED=true の場合のみ動作。
      const alertsIngestor = getAlertsIngestor();
      await alertsIngestor.start();

      // Graceful shutdown (best-effort)
      const shutdown = async (signal: string) => {
        try {
          logger.info({ signal }, 'Shutting down API server');
          await alertsIngestor.stop();
          await alertsDispatcher.stop();
          await app.close();
        } catch (err) {
          logger.warn({ err, signal }, 'Failed during shutdown');
        } finally {
          process.exit(0);
        }
      };

      process.once('SIGINT', () => void shutdown('SIGINT'));
      process.once('SIGTERM', () => void shutdown('SIGTERM'));
    })
    .catch((err) => {
      logger.error({ err }, 'Failed to start API server');
      process.exit(1);
    });
}
