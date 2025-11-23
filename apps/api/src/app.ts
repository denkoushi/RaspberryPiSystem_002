import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerRoutes } from './routes/index.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  registerErrorHandler(app);
  await registerSecurityHeaders(app);
  await registerRateLimit(app);
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB per file is enough for ~100 rows CSV
      files: 2
    }
  });
  await registerRoutes(app);
  return app;
}
