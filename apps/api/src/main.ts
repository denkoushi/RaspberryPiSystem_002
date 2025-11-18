import { buildServer } from './app.js';
import { env } from './config/env.js';

if (process.env['NODE_ENV'] !== 'test') {
  buildServer()
    .then((app) => app.listen({ port: env.PORT, host: env.HOST }))
    .then((address) => {
      console.log(`API server listening on ${address}`);
    })
    .catch((err) => {
      console.error('Failed to start API server', err);
      process.exit(1);
    });
}
