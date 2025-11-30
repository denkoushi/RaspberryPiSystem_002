import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerRequestLogger } from './plugins/request-logger.js';
import { registerRoutes } from './routes/index.js';
import { PhotoStorage } from './lib/photo-storage.js';
import { PdfStorage } from './lib/pdf-storage.js';
import { SignageRenderStorage } from './lib/signage-render-storage.js';
import { SignageRenderScheduler } from './services/signage/signage-render-scheduler.js';
import { SignageRenderer } from './services/signage/signage.renderer.js';
import { SignageService } from './services/signage/index.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  registerErrorHandler(app);
  registerRequestLogger(app);
  await registerSecurityHeaders(app);
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB per file (PDF対応)
      files: 10
    }
  });
  
  // ストレージディレクトリを初期化
  try {
    await PhotoStorage.initialize();
    app.log.info('Photo storage directories initialized');
  } catch (error) {
    app.log.warn({ err: error }, 'Failed to initialize photo storage directories (may not be critical)');
  }
  
  try {
    await PdfStorage.initialize();
    app.log.info('PDF storage directories initialized');
  } catch (error) {
    app.log.warn({ err: error }, 'Failed to initialize PDF storage directories (may not be critical)');
  }

  try {
    await SignageRenderStorage.initialize();
    app.log.info('Signage render storage initialized');
  } catch (error) {
    app.log.warn({ err: error }, 'Failed to initialize signage render storage (may not be critical)');
  }
  
  // サイネージレンダリングスケジューラーを作成（ルートからアクセス可能にするため）
  const signageService = new SignageService();
  const signageRenderer = new SignageRenderer(signageService);
  const scheduler = new SignageRenderScheduler(signageRenderer, env.SIGNAGE_RENDER_INTERVAL_SECONDS);
  
  // アプリケーションコンテキストにスケジューラーを保存
  app.decorate('signageRenderScheduler', scheduler);
  
  // ルートを登録
  await registerRoutes(app);
  // 注意: レート制限プラグインは`routes/index.ts`と`routes/tools/index.ts`でサブルーター内に登録されているため、
  // ここでは登録しない（重複登録を避けるため）
  return app;
}
