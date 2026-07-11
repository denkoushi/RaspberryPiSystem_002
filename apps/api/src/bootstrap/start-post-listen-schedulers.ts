import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { getBackupScheduler } from '../services/backup/backup-scheduler.js';
import { getCsvImportScheduler } from '../services/imports/csv-import-scheduler.js';
import { getKioskDocumentGmailScheduler } from '../services/kiosk-documents/kiosk-document-gmail.scheduler.js';
import { getKioskDocumentOcrScheduler } from '../services/kiosk-documents/kiosk-document-ocr.scheduler.js';
import { getGmailTrashCleanupScheduler } from '../services/gmail/gmail-trash-cleanup.scheduler.js';
import { getDueManagementTuningOrchestrator } from '../services/production-schedule/auto-tuning/tuning-orchestrator.service.js';
import { getAlertsDispatcher } from '../services/alerts/alerts-dispatcher.js';
import { getAlertsDbDispatcher } from '../services/alerts/alerts-db-dispatcher.js';
import { getAlertsIngestor } from '../services/alerts/alerts-ingestor.js';
import { loadAlertsDispatcherConfig } from '../services/alerts/alerts-config.js';
import { getPhotoToolLabelScheduler } from '../services/tools/photo-tool-label/photo-tool-label.scheduler.js';
import { getPartMeasurementDrawingOcrScheduler } from '../services/part-measurement/part-measurement-drawing-ocr.scheduler.js';

export type PostListenSchedulerHandles = {
  signageRenderScheduler: FastifyInstance['signageRenderScheduler'];
  alertsIngestor: ReturnType<typeof getAlertsIngestor>;
  alertsDbDispatcher: ReturnType<typeof getAlertsDbDispatcher>;
  alertsDispatcher: ReturnType<typeof getAlertsDispatcher>;
  kioskDocOcrScheduler: ReturnType<typeof getKioskDocumentOcrScheduler>;
  gmailTrashCleanupScheduler: ReturnType<typeof getGmailTrashCleanupScheduler>;
  dueManagementTuningOrchestrator: ReturnType<typeof getDueManagementTuningOrchestrator>;
  partMeasurementDrawingOcrScheduler: ReturnType<typeof getPartMeasurementDrawingOcrScheduler>;
};

export async function stopPostListenSchedulers(
  app: FastifyInstance,
  handles: PostListenSchedulerHandles
): Promise<void> {
  await handles.alertsIngestor.stop();
  await handles.alertsDbDispatcher.stop();
  await handles.alertsDispatcher.stop();
  handles.kioskDocOcrScheduler.stop();
  getKioskDocumentGmailScheduler().stop();
  handles.gmailTrashCleanupScheduler.stop();
  handles.dueManagementTuningOrchestrator.stop();
  handles.partMeasurementDrawingOcrScheduler.stop();
  getPhotoToolLabelScheduler().stop();
  app.signageRenderScheduler.stop();
}

/**
 * listen 完了後のバックグラウンドジョブ起動を一箇所に集約。
 * クリティカルパス（HTTP 受付可能）と分離し、起動コードの見通しと Pi 上の初期体感を改善する。
 */
export async function startPostListenSchedulers(app: FastifyInstance): Promise<PostListenSchedulerHandles> {
  app.signageRenderScheduler.start();

  logger.info(
    { intervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS, runner: env.SIGNAGE_RENDER_RUNNER },
    'Signage render scheduler started'
  );

  const backupScheduler = getBackupScheduler();
  await backupScheduler.start();
  logger.info('Backup scheduler started');

  const csvImportScheduler = getCsvImportScheduler();
  await csvImportScheduler.start();
  logger.info('CSV import scheduler started');

  const kioskDocGmailScheduler = getKioskDocumentGmailScheduler();
  await kioskDocGmailScheduler.start();
  logger.info('Kiosk document Gmail scheduler started');

  const kioskDocOcrScheduler = getKioskDocumentOcrScheduler();
  await kioskDocOcrScheduler.start();
  logger.info('Kiosk document OCR scheduler started');

  const gmailTrashCleanupScheduler = getGmailTrashCleanupScheduler();
  await gmailTrashCleanupScheduler.start();
  logger.info('Gmail trash cleanup scheduler started');

  const dueManagementTuningOrchestrator = getDueManagementTuningOrchestrator();
  await dueManagementTuningOrchestrator.start();
  logger.info('Due management auto-tuning scheduler started');

  const alertsConfig = await loadAlertsDispatcherConfig();
  const alertsDispatcher = getAlertsDispatcher();
  const alertsDbDispatcher = getAlertsDbDispatcher();
  if (alertsConfig.mode === 'db') {
    await alertsDbDispatcher.start();
  } else {
    await alertsDispatcher.start();
  }

  const alertsIngestor = getAlertsIngestor();
  await alertsIngestor.start();

  const photoToolLabelScheduler = getPhotoToolLabelScheduler();
  photoToolLabelScheduler.start();
  logger.info('Photo tool label scheduler started');

  const partMeasurementDrawingOcrScheduler = getPartMeasurementDrawingOcrScheduler();
  await partMeasurementDrawingOcrScheduler.start();
  logger.info('Part measurement drawing OCR scheduler started');

  return {
    signageRenderScheduler: app.signageRenderScheduler,
    alertsIngestor,
    alertsDbDispatcher,
    alertsDispatcher,
    kioskDocOcrScheduler,
    gmailTrashCleanupScheduler,
    dueManagementTuningOrchestrator,
    partMeasurementDrawingOcrScheduler
  };
}
