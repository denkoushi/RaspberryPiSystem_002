import Fastify from 'fastify';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerRequestLogger } from './plugins/request-logger.js';
import { registerLocalLlmGateway } from './plugins/local-llm-gateway.js';
import { registerRoutes } from './routes/index.js';
import { initializeCsvImporters } from './services/imports/index.js';
import { initializeVisualizationModules } from './services/visualization/index.js';
import { initializeFileStorageRuntime } from './services/file-storage/file-storage-runtime.js';
import { SignageRenderScheduler } from './services/signage/signage-render-scheduler.js';
import { SignageRenderer } from './services/signage/signage.renderer.js';
import { SignageService } from './services/signage/index.js';
import { probePlaywrightChromiumAvailability } from './services/signage/loan-grid/playwright/playwright-chromium-availability.js';
import { refreshProductionScheduleOrderSplitPilotGateCache } from './services/production-schedule/order-split/production-schedule-order-split-feature.js';
import { createSchedulerRuntimeState } from './bootstrap/scheduler-runtime-state.js';
import { createDeployReadinessObservability } from './services/system/deploy-readiness-observability.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  registerErrorHandler(app);
  registerRequestLogger(app);
  app.decorate('schedulerRuntimeState', createSchedulerRuntimeState());
  app.decorate('deployReadinessObservability', createDeployReadinessObservability());

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
      allowedHeaders: ['Authorization', 'Content-Type', 'x-client-key', 'Idempotency-Key']
    });
  }

  // レート制限はここで全体に登録し、必要なルートのみ個別に除外する。
  await registerRateLimit(app);
  await registerSecurityHeaders(app);
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['gzip', 'br']
  });
  await app.register(websocket);
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB per file (PDF対応)
      files: 10
    }
  });
  
  try {
    const fileStorage = await initializeFileStorageRuntime();
    const snapshot = fileStorage.health.snapshot();
    if (snapshot.status === 'error' && env.NODE_ENV === 'production') {
      throw new Error(`File storage startup check failed: ${snapshot.reason ?? 'unavailable'}`);
    }
    app.log.info(
      {
        status: snapshot.status,
        reason: snapshot.reason,
        usagePercent: snapshot.usagePercent,
      },
      'File storage initialized'
    );
  } catch (error) {
    if (env.NODE_ENV === 'production') {
      throw error;
    }
    app.log.warn({ err: error }, 'File storage startup check failed outside production');
  }

  const playwrightAvailability = await probePlaywrightChromiumAvailability();
  if (playwrightAvailability.available) {
    app.log.info(
      { browserVersion: playwrightAvailability.browserVersion },
      'Playwright headless Chromium is available'
    );
  } else {
    app.log.warn(playwrightAvailability.message);
  }
  
  // サイネージレンダリングスケジューラーを作成（ルートからアクセス可能にするため）
  const signageService = new SignageService();
  const signageRenderer = new SignageRenderer(signageService);
  const scheduler = new SignageRenderScheduler(signageRenderer, env.SIGNAGE_RENDER_INTERVAL_SECONDS);
  
  // アプリケーションコンテキストにスケジューラーを保存
  app.decorate('signageRenderScheduler', scheduler);
  await registerLocalLlmGateway(app);
  
  // CSVインポータを初期化
  initializeCsvImporters();
  initializeVisualizationModules();
  app.log.info('CSV importers initialized');

  if (env.NODE_ENV !== 'test') {
    try {
      const splitPilotStatus = await refreshProductionScheduleOrderSplitPilotGateCache();
      app.log.info(splitPilotStatus, 'Production schedule order split pilot gate initialized');
    } catch (err) {
      app.log.warn(
        { err },
        'Production schedule order split pilot gate could not be loaded; keeping runtime gate OFF'
      );
    }
  }
  
  // ルートを登録
  await registerRoutes(app);
  return app;
}
