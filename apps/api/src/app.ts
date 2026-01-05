import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerRequestLogger } from './plugins/request-logger.js';
import { registerRoutes } from './routes/index.js';
import { initializeCsvImporters } from './services/imports/index.js';
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

  // NOTE:
  // - 本番は基本的に同一オリジン（リバプロ経由）で運用するため、CORSは不要。
  // - CI/E2Eでは Web(4173) → API(8080) のクロスオリジンになり、Authorization付きリクエストで
  //   preflight(OPTIONS)が発生する。CORS未設定だとOPTIONSが404になりブラウザが本リクエストをブロックする。
  // - そのため development/test のみ CORS を有効化する。
  if (env.NODE_ENV !== 'production') {
    await app.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // Web側はapi clientで x-client-key をデフォルト付与するため、preflightで許可が必要
      allowedHeaders: ['Authorization', 'Content-Type', 'x-client-key']
    });
  }

  await registerRateLimit(app);
  await registerSecurityHeaders(app);
  await app.register(websocket);
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
  
  // CSVインポータを初期化
  initializeCsvImporters();
  app.log.info('CSV importers initialized');
  
  // ルートを登録
  await registerRoutes(app);
  // 注意: レート制限プラグインは`routes/index.ts`と`routes/tools/index.ts`でサブルーター内に登録されているため、
  // ここでは登録しない（重複登録を避けるため）
  return app;
}
