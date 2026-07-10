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
import { MeasuringInstrumentGenreImageStorage } from './lib/measuring-instrument-genre-image-storage.js';
import { AssemblyProcedureImageStorage } from './lib/assembly-procedure-image-storage.js';
import { PartMeasurementDrawingStorage } from './lib/part-measurement-drawing-storage.js';
import { PalletMachineIllustrationStorage } from './lib/pallet-machine-illustration-storage.js';
import { PhotoStorage } from './lib/photo-storage.js';
import { PdfStorage } from './lib/pdf-storage.js';
import { SignageRenderStorage } from './lib/signage-render-storage.js';
import { CsvDashboardStorage } from './lib/csv-dashboard-storage.js';
import { SignageRenderScheduler } from './services/signage/signage-render-scheduler.js';
import { SignageRenderer } from './services/signage/signage.renderer.js';
import { SignageService } from './services/signage/index.js';
import { probePlaywrightChromiumAvailability } from './services/signage/loan-grid/playwright/playwright-chromium-availability.js';
import { refreshProductionScheduleOrderSplitPilotGateCache } from './services/production-schedule/order-split/production-schedule-order-split-feature.js';

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
  
  // ストレージディレクトリを初期化（I/O 並列化で起動クリティカルパス短縮）
  const storageTasks: Array<{ label: string; run: () => Promise<unknown> }> = [
    { label: 'Photo storage directories', run: () => PhotoStorage.initialize() },
    { label: 'Assembly procedure image storage', run: () => AssemblyProcedureImageStorage.initialize() },
    { label: 'Measuring instrument genre image storage', run: () => MeasuringInstrumentGenreImageStorage.initialize() },
    { label: 'Part-measurement drawing storage', run: () => PartMeasurementDrawingStorage.initialize() },
    { label: 'Pallet machine illustration storage', run: () => PalletMachineIllustrationStorage.initialize() },
    { label: 'PDF storage directories', run: () => PdfStorage.initialize() },
    { label: 'Signage render storage', run: () => SignageRenderStorage.initialize() },
    { label: 'CSV dashboard storage', run: () => CsvDashboardStorage.initialize() }
  ];

  const settled = await Promise.allSettled(storageTasks.map((t) => t.run()));
  for (let i = 0; i < settled.length; i += 1) {
    const task = storageTasks[i]!;
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      app.log.info(`${task.label} initialized`);
    } else {
      app.log.warn({ err: r.reason }, `${task.label}: init failed (may not be critical)`);
    }
  }

  const playwrightAvailability = probePlaywrightChromiumAvailability();
  if (playwrightAvailability.available) {
    app.log.info(
      { executablePath: playwrightAvailability.executablePath },
      'Playwright Chromium is available'
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
