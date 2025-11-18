import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

type HealthResponse = { status: 'ok' };

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' } satisfies HealthResponse));

  return app;
}

if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] || 8080);
  buildServer()
    .then((app) => app.listen({ port, host: '0.0.0.0' }))
    .then((address) => {
      console.log(`API server listening on ${address}`);
    })
    .catch((err) => {
      console.error('Failed to start API server', err);
      process.exit(1);
    });
}
