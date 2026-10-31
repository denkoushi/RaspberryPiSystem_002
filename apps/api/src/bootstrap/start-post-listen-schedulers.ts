import { getWatchCameraRetentionScheduler } from '../services/watch-camera/watch-camera-retention.scheduler.js';
import { getProcedureMaterialImageDescriptionScheduler } from '../services/assembly/procedure-material-image-description.scheduler.js';
import { getSystemNoticeEvaluator } from '../services/kiosk-inquiry/system-notice-evaluator.js';
import { getCsvFeedFreshnessEvaluator } from '../services/kiosk-inquiry/csv-feed-freshness-evaluator.js';
import { getProcedureVideoScheduler } from '../services/assembly/procedure-video.scheduler.js';
import type { FastifyInstance } from 'fastify';
import { getKnowledgeRuntime } from '../services/knowledge/knowledge-runtime.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { getProcedureTermLearningScheduler } from '../services/assembly/procedure-term-learning.scheduler.js';
import { getAdvisoryCheckScheduler } from '../services/advisory-check/advisory-check.scheduler.js';
import { getSecurityReviewQueueScheduler } from '../services/security-review/security-review-queue.scheduler.js';
import { getSecurityReviewScheduler } from '../services/security-review/security-review.scheduler.js';
import { getBusinessHermesNightlyScheduler } from '../services/business-hermes/business-hermes-nightly.scheduler.js';
import { getBackupScheduler } from '../services/backup/backup-scheduler.js';
import { getCsvImportScheduler } from '../services/imports/csv-import-scheduler.js';
import { getKioskDocumentGmailScheduler } from '../services/kiosk-documents/kiosk-document-gmail.scheduler.js';
import { getKioskDocumentOcrScheduler } from '../services/kiosk-documents/kiosk-document-ocr.scheduler.js';
import { getWorkInstructionGmailScheduler } from '../services/work-instructions/work-instruction-gmail.scheduler.js';
import { getGmailTrashCleanupScheduler } from '../services/gmail/gmail-trash-cleanup.scheduler.js';
import { getDueManagementTuningOrchestrator } from '../services/production-schedule/auto-tuning/tuning-orchestrator.service.js';
import { getFkojunstMailSupersededPruneScheduler } from '../services/production-schedule/fkojunst-status-mail-superseded-prune.scheduler.js';
import { getAlertsDispatcher } from '../services/alerts/alerts-dispatcher.js';
import { getAlertsDbDispatcher } from '../services/alerts/alerts-db-dispatcher.js';
import { getAlertsIngestor } from '../services/alerts/alerts-ingestor.js';
import { getClientNetworkLogRetentionScheduler } from '../services/clients/client-network-log-retention.scheduler.js';
import { getClientHeartbeatMonitor } from '../services/clients/client-heartbeat-monitor.js';
import { loadAlertsDispatcherConfig } from '../services/alerts/alerts-config.js';
import { getPhotoToolLabelScheduler } from '../services/tools/photo-tool-label/photo-tool-label.scheduler.js';
import { getPartMeasurementDrawingOcrScheduler } from '../services/part-measurement/part-measurement-drawing-ocr.scheduler.js';
import { getPartMeasurementDrawingDimensionMapScheduler } from '../services/part-measurement/part-measurement-drawing-dimension-map.scheduler.js';
import { isPartMeasurementDrawingDimensionMapEnabled } from '../services/part-measurement/part-measurement-drawing-dimension-map.service.js';
import {
  FileStorageIntegrityBackfillService,
  getFileStorageIntegrityBackfillScheduler,
} from '../services/file-storage/file-storage-integrity-backfill.service.js';
import { getFileStorageRuntime } from '../services/file-storage/file-storage-runtime.js';
import { createGrindingPlanningBoardStartupWarmup } from '../services/production-schedule/grinding-planning-board/startup-warmup.js';
import { leaderboardShellSnapshotStore } from '../services/production-schedule/leaderboard/kiosk-leaderboard-snapshot-store.js';
import {
  errorForLog,
  isSchedulerStepStateAmbiguousError,
  SchedulerStartupCleanupError,
} from './scheduler-errors.js';

export type SchedulerStep = {
  name: string;
  stop: () => void | Promise<void>;
};

export type SchedulerStepDefinition = {
  name: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
};

export type PostListenSchedulerHandles = {
  steps: SchedulerStep[];
};

function asErrors(error: unknown): Error[] {
  if (error instanceof AggregateError) {
    return error.errors.map((entry) => errorForLog(entry));
  }
  return [errorForLog(error)];
}

/**
 * Stop started schedulers in reverse order. Collect every stop failure into one AggregateError.
 */
export async function stopSchedulerStepGroup(steps: SchedulerStep[]): Promise<void> {
  const errors: unknown[] = [];
  for (const step of [...steps].reverse()) {
    try {
      await step.stop();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'One or more post-listen schedulers failed to stop');
  }
}

/**
 * Start schedulers sequentially. On start failure, reverse-stop anything already started.
 * If cleanup itself fails, throw SchedulerStartupCleanupError (ambiguous ownership).
 */
export async function startSchedulerStepGroup(
  definitions: SchedulerStepDefinition[]
): Promise<SchedulerStep[]> {
  const steps: SchedulerStep[] = [];
  try {
    for (const definition of definitions) {
      await definition.start();
      steps.push({ name: definition.name, stop: definition.stop });
    }
    return steps;
  } catch (startError) {
    const startErrors = isSchedulerStepStateAmbiguousError(startError)
      ? startError.causeErrors
      : [errorForLog(startError)];
    try {
      await stopSchedulerStepGroup(steps);
    } catch (cleanupError) {
      throw new SchedulerStartupCleanupError([...startErrors, ...asErrors(cleanupError)]);
    }
    if (isSchedulerStepStateAmbiguousError(startError)) {
      throw new SchedulerStartupCleanupError(startErrors);
    }
    throw startError;
  }
}

export function buildPostListenSchedulerDefinitions(app: FastifyInstance): SchedulerStepDefinition[] {
  const definitions: SchedulerStepDefinition[] = [];
  const grindingPlanningBoardWarmup = createGrindingPlanningBoardStartupWarmup({
    enabled: env.GRINDING_PLANNING_BOARD_STARTUP_WARMUP_ENABLED,
    delayMs: env.GRINDING_PLANNING_BOARD_STARTUP_WARMUP_DELAY_MS,
    snapshotStore: leaderboardShellSnapshotStore
  });
  if (process.env.HERMES_KNOWLEDGE_ENABLED === 'true') {
    definitions.push({ name: 'hermes-knowledge',
      start: async () => { const runtime = getKnowledgeRuntime(); await runtime.documents.initialize(); runtime.worker.start(); await runtime.ensureReferenceData(); runtime.procedureWorker.start(); },
      stop: async () => { const runtime = getKnowledgeRuntime(); await Promise.all([runtime.worker.stop(), runtime.procedureWorker.stop()]); },
    });
  }
  if (env.SIGNAGE_RENDER_ENABLED) {
    definitions.push({
      name: 'signage-render',
      start: async () => {
        await app.signageRenderScheduler.resumeAfterDeploy();
        logger.info(
          { intervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS, runner: env.SIGNAGE_RENDER_RUNNER },
          'Signage render scheduler started'
        );
      },
      stop: async () => {
        await app.signageRenderScheduler.pauseForDeploy();
      },
    });
  } else {
    logger.info('Signage render scheduler is disabled by environment');
  }
  if (isPartMeasurementDrawingDimensionMapEnabled()) {
    definitions.push({
      name: 'part-measurement-drawing-dimension-map',
      start: () => {
        getPartMeasurementDrawingDimensionMapScheduler().start();
        logger.info('Part measurement drawing dimension map scheduler started');
      },
      stop: () => {
        getPartMeasurementDrawingDimensionMapScheduler().stop();
      },
    });
  }

  return [
    ...definitions,
    { name: 'grinding-planning-board-startup-warmup', start: () => grindingPlanningBoardWarmup.start(),
      stop: () => grindingPlanningBoardWarmup.stop() },
    { name: 'procedure-term-learning', start: () => getProcedureTermLearningScheduler().start(),
      stop: () => getProcedureTermLearningScheduler().stop() },
    { name: 'advisory-check', start: () => getAdvisoryCheckScheduler().start(),
      stop: () => getAdvisoryCheckScheduler().stop() },
    { name: 'security-review-queue', start: () => getSecurityReviewQueueScheduler().start(),
      stop: () => getSecurityReviewQueueScheduler().stop() },
    { name: 'security-review-nightly', start: () => getSecurityReviewScheduler().start(),
      stop: () => getSecurityReviewScheduler().stop() },
    { name: 'business-hermes-nightly', start: () => getBusinessHermesNightlyScheduler().start(),
      stop: () => getBusinessHermesNightlyScheduler().stop() },
    { name: 'fkojunst-mail-superseded-prune', start: () => getFkojunstMailSupersededPruneScheduler().start(),
      stop: () => getFkojunstMailSupersededPruneScheduler().stop() },
    {
      name: 'file-storage-integrity-backfill',
      start: () => {
        const runtime = getFileStorageRuntime();
        getFileStorageIntegrityBackfillScheduler().start(
          new FileStorageIntegrityBackfillService(
            runtime.root,
            runtime.store,
            runtime.catalog
          )
        );
        logger.info('File storage integrity backfill scheduler started');
      },
      stop: () => getFileStorageIntegrityBackfillScheduler().stop(),
    },
    {
      name: 'backup',
      start: async () => {
        await getBackupScheduler().start();
        logger.info('Backup scheduler started');
      },
      stop: () => {
        getBackupScheduler().stop();
      },
    },
    {
      name: 'csv-import',
      start: async () => {
        await getCsvImportScheduler().start();
        logger.info('CSV import scheduler started');
      },
      stop: () => {
        getCsvImportScheduler().stop();
      },
    },
    {
      name: 'kiosk-document-gmail',
      start: async () => {
        await getKioskDocumentGmailScheduler().start();
        logger.info('Kiosk document Gmail scheduler started');
      },
      stop: () => {
        getKioskDocumentGmailScheduler().stop();
      },
    },
    { name: 'procedure-video', start: () => getProcedureVideoScheduler().start(), stop: () => getProcedureVideoScheduler().stop() },
    {
      name: 'kiosk-document-ocr',
      start: async () => {
        await getKioskDocumentOcrScheduler().start();
        logger.info('Kiosk document OCR scheduler started');
      },
      stop: () => {
        getKioskDocumentOcrScheduler().stop();
      },
    },
    {
      name: 'work-instruction-gmail',
      start: async () => {
        await getWorkInstructionGmailScheduler().start();
        logger.info('Work-instruction Gmail scheduler started');
      },
      stop: () => {
        getWorkInstructionGmailScheduler().stop();
      },
    },
    {
      name: 'gmail-trash-cleanup',
      start: async () => {
        await getGmailTrashCleanupScheduler().start();
        logger.info('Gmail trash cleanup scheduler started');
      },
      stop: () => {
        getGmailTrashCleanupScheduler().stop();
      },
    },
    {
      name: 'due-management-tuning',
      start: async () => {
        await getDueManagementTuningOrchestrator().start();
        logger.info('Due management auto-tuning scheduler started');
      },
      stop: () => {
        getDueManagementTuningOrchestrator().stop();
      },
    },
    {
      name: 'alerts-dispatcher',
      start: async () => {
        const alertsConfig = await loadAlertsDispatcherConfig();
        if (alertsConfig.mode === 'db') {
          await getAlertsDbDispatcher().start();
        } else {
          await getAlertsDispatcher().start();
        }
      },
      stop: async () => {
        await getAlertsDbDispatcher().stop();
        await getAlertsDispatcher().stop();
      },
    },
    {
      name: 'watch-camera-retention',
      start: () => getWatchCameraRetentionScheduler().start(),
      stop: () => getWatchCameraRetentionScheduler().stop(),
    },
    {
      name: 'client-network-log-retention',
      start: () => getClientNetworkLogRetentionScheduler().start(),
      stop: () => getClientNetworkLogRetentionScheduler().stop(),
    },
    {
      name: 'client-heartbeat-monitor',
      start: async () => {
        // Alerts are only delivered to Slack by the DB dispatcher.
        const alertsConfig = await loadAlertsDispatcherConfig();
        if (alertsConfig.mode === 'db') {
          await getClientHeartbeatMonitor().start();
        }
      },
      stop: async () => {
        await getClientHeartbeatMonitor().stop();
      },
    },
    {
      name: 'system-notice-evaluator',
      start: () => getSystemNoticeEvaluator().start(),
      stop: () => getSystemNoticeEvaluator().stop(),
    },
    {
      name: 'csv-feed-freshness-evaluator',
      start: () => getCsvFeedFreshnessEvaluator().start(),
      stop: () => getCsvFeedFreshnessEvaluator().stop(),
    },
    {
      name: 'alerts-ingestor',
      start: async () => {
        await getAlertsIngestor().start();
      },
      stop: async () => {
        await getAlertsIngestor().stop();
      },
    },
    {
      name: 'photo-tool-label',
      start: () => {
        getPhotoToolLabelScheduler().start();
        logger.info('Photo tool label scheduler started');
      },
      stop: () => {
        getPhotoToolLabelScheduler().stop();
      },
    },
    {
      name: 'procedure-material-image-description',
      start: () => { getProcedureMaterialImageDescriptionScheduler().start(); },
      stop: () => { getProcedureMaterialImageDescriptionScheduler().stop(); },
    },
    {
      name: 'part-measurement-drawing-ocr',
      start: async () => {
        await getPartMeasurementDrawingOcrScheduler().start();
        logger.info('Part measurement drawing OCR scheduler started');
      },
      stop: () => {
        getPartMeasurementDrawingOcrScheduler().stop();
      },
    },
  ];
}

export function listPostListenSchedulerNames(): string[] {
  // Names only — used by unit tests to assert Backup/CSV membership without starting jobs.
  return [
    'hermes-knowledge',
    'signage-render',
    'part-measurement-drawing-dimension-map',
    'grinding-planning-board-startup-warmup',
    'procedure-term-learning',
    'business-hermes-nightly',
    'security-review-nightly',
    'security-review-queue',
    'advisory-check',
    'fkojunst-mail-superseded-prune',
    'file-storage-integrity-backfill',
    'backup',
    'csv-import',
    'kiosk-document-gmail',
    'procedure-video',
    'kiosk-document-ocr',
    'work-instruction-gmail',
    'gmail-trash-cleanup',
    'due-management-tuning',
    'alerts-dispatcher',
    'watch-camera-retention',
    'client-network-log-retention',
    'client-heartbeat-monitor',
    'system-notice-evaluator',
    'csv-feed-freshness-evaluator',
    'alerts-ingestor',
    'photo-tool-label',
    'procedure-material-image-description',
    'part-measurement-drawing-ocr',
  ];
}

/**
 * listen 完了後のバックグラウンドジョブ起動を一箇所に集約。
 * 起動失敗時は既に開始したジョブを逆順停止し、停止も曖昧なら fail-closed 用エラーにする。
 */
export async function startPostListenSchedulers(
  app: FastifyInstance
): Promise<PostListenSchedulerHandles> {
  const steps = await startSchedulerStepGroup(buildPostListenSchedulerDefinitions(app));
  return { steps };
}

export async function stopPostListenSchedulers(
  _app: FastifyInstance,
  handles: PostListenSchedulerHandles
): Promise<void> {
  await stopSchedulerStepGroup(handles.steps);
}
