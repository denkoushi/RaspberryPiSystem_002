import { buildServer } from './app.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';

if (process.env['NODE_ENV'] !== 'test') {
  buildServer()
    .then((app) => app.listen({ port: env.PORT, host: env.HOST }))
    .then((address) => {
      logger.info({ address }, 'API server listening');
    })
    .catch((err) => {
      logger.error({ err }, 'Failed to start API server');
      process.exit(1);
    });
}
