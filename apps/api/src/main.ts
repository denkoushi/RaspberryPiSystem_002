import { buildServer } from './app.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';
import { getKioskDocumentGmailScheduler } from './services/kiosk-documents/kiosk-document-gmail.scheduler.js';
import { getPhotoToolLabelScheduler } from './services/tools/photo-tool-label/photo-tool-label.scheduler.js';
import { startPostListenSchedulers } from './bootstrap/start-post-listen-schedulers.js';

if (process.env['NODE_ENV'] !== 'test') {
  buildServer()
    .then(async (app) => {
      await app.listen({ port: env.PORT, host: env.HOST });
      logger.info({ address: `http://${env.HOST}:${env.PORT}` }, 'API server listening');

      const handles = await startPostListenSchedulers(app);

      // Graceful shutdown (best-effort)
      const shutdown = async (signal: string) => {
        try {
          logger.info({ signal }, 'Shutting down API server');
          await handles.alertsIngestor.stop();
          await handles.alertsDbDispatcher.stop();
          await handles.alertsDispatcher.stop();
          getKioskDocumentGmailScheduler().stop();
          handles.kioskDocOcrScheduler.stop();
          handles.gmailTrashCleanupScheduler.stop();
          handles.dueManagementTuningOrchestrator.stop();
          getPhotoToolLabelScheduler().stop();
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
