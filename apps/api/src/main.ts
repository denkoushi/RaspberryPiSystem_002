import { buildServer } from './app.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';

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
    })
    .catch((err) => {
      logger.error({ err }, 'Failed to start API server');
      process.exit(1);
    });
}
