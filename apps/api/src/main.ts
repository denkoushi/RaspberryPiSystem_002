import { buildServer } from './app.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';
import { SignageRenderScheduler } from './services/signage/signage-render-scheduler.js';
import { SignageRenderer } from './services/signage/signage.renderer.js';
import { SignageService } from './services/signage/index.js';

if (process.env['NODE_ENV'] !== 'test') {
  buildServer()
    .then((app) => app.listen({ port: env.PORT, host: env.HOST }))
    .then((address) => {
      logger.info({ address }, 'API server listening');
      
      // サイネージレンダリングの定期実行を開始
      const renderIntervalSeconds = parseInt(
        process.env.SIGNAGE_RENDER_INTERVAL_SECONDS || '30',
        10
      );
      const signageService = new SignageService();
      const signageRenderer = new SignageRenderer(signageService);
      const scheduler = new SignageRenderScheduler(signageRenderer, renderIntervalSeconds);
      scheduler.start();
      
      logger.info({ intervalSeconds: renderIntervalSeconds }, 'Signage render scheduler started');
    })
    .catch((err) => {
      logger.error({ err }, 'Failed to start API server');
      process.exit(1);
    });
}
