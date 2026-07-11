import { buildServer } from './app.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';
import { startSchedulerRuntime } from './bootstrap/scheduler-leader.js';
import { isCandidateValidationMode } from './bootstrap/candidate-validation.js';

if (process.env['NODE_ENV'] !== 'test') {
  buildServer()
    .then(async (app) => {
      await app.listen({ port: env.PORT, host: env.HOST });
      logger.info({ address: `http://${env.HOST}:${env.PORT}` }, 'API server listening');

      const schedulerRuntime = isCandidateValidationMode() ? null : await startSchedulerRuntime(app);
      if (schedulerRuntime === null) {
        logger.info('Candidate validation mode: background schedulers are disabled');
      }

      // Graceful shutdown (best-effort)
      const shutdown = async (signal: string) => {
        try {
          logger.info({ signal }, 'Shutting down API server');
          if (schedulerRuntime !== null) await schedulerRuntime.stop();
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
