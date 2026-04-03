import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { initializeVisualizationModules } from '../visualization/initialize.js';
import { SignageService } from './index.js';
import { SignageRenderScheduler } from './signage-render-scheduler.js';
import { SignageRenderer } from './signage.renderer.js';
import { closeSharedChromium } from './loan-grid/playwright/playwright-browser-pool.js';

// NOTE:
// - This file is executed as a standalone Node process (forked from the API process).
// - Goal: isolate heavy signage rendering from the API event loop to avoid kiosk UI stalls.
// - The parent process forces SIGNAGE_RENDER_RUNNER=in_process for this worker via env.

// NOTE:
// This worker process does not go through buildServer(), so we must initialize
// visualization registries here. Otherwise rendering fails with:
//   "Data source not found: production_schedule"
initializeVisualizationModules();

const signageService = new SignageService();
const signageRenderer = new SignageRenderer(signageService);
const scheduler = new SignageRenderScheduler(signageRenderer, env.SIGNAGE_RENDER_INTERVAL_SECONDS);

logger.info(
  { intervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS, runner: env.SIGNAGE_RENDER_RUNNER, pid: process.pid },
  'Signage render worker boot'
);

scheduler.start();

const shutdown = async (signal: string) => {
  try {
    logger.info({ signal }, 'Signage render worker shutting down');
    scheduler.stop();
  } catch (err) {
    logger.warn({ err, signal }, 'Signage render worker shutdown failed');
  }
  try {
    await closeSharedChromium();
  } catch {
    // ignore
  }
  process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

