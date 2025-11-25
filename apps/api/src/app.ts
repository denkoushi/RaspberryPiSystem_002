import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerRequestLogger } from './plugins/request-logger.js';
import { registerRoutes } from './routes/index.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  registerErrorHandler(app);
  registerRequestLogger(app);
  await registerSecurityHeaders(app);
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB per file is enough for ~100 rows CSV
      files: 2
    }
  });
  // ルートを登録
  await registerRoutes(app);
  // 注意: レート制限プラグインは`routes/index.ts`と`routes/tools/index.ts`でサブルーター内に登録されているため、
  // ここでは登録しない（重複登録を避けるため）
  return app;
}
