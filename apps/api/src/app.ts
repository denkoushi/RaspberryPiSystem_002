import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRoutes } from './routes/index.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  registerErrorHandler(app);
  await registerRoutes(app);
  return app;
}
