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
import { errorForLog, SchedulerStartupCleanupError } from './scheduler-errors.js';

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
    try {
      await stopSchedulerStepGroup(steps);
    } catch (cleanupError) {
      throw new SchedulerStartupCleanupError([errorForLog(startError), ...asErrors(cleanupError)]);
    }
    throw startError;
  }
}

export function buildPostListenSchedulerDefinitions(app: FastifyInstance): SchedulerStepDefinition[] {
  return [
    {
      name: 'signage-render',
      start: () => {
        app.signageRenderScheduler.start();
        logger.info(
          { intervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS, runner: env.SIGNAGE_RENDER_RUNNER },
          'Signage render scheduler started'
        );
      },
      stop: () => {
        app.signageRenderScheduler.stop();
      },
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
    'signage-render',
    'backup',
    'csv-import',
    'kiosk-document-gmail',
    'kiosk-document-ocr',
    'gmail-trash-cleanup',
    'due-management-tuning',
    'alerts-dispatcher',
    'alerts-ingestor',
    'photo-tool-label',
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
