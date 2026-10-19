import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { WorkInstructionGmailIngestionService } from './work-instruction-gmail-ingestion.service.js';
import { getWorkInstructionServices } from './work-instruction-service.factory.js';
import type { WorkInstructionEditAssetCleanupService } from './work-instruction-edit-asset-cleanup.service.js';

export const WORK_INSTRUCTION_GMAIL_CRON = '*/5 * * * *';

/**
 * Leader-owned fixed five-minute poller. Configuration is loaded inside each
 * tick so enabling/disabling the feature does not depend on scheduler reload.
 */
export class WorkInstructionGmailScheduler {
  private task: cron.ScheduledTask | null = null;
  private tickRunning = false;

  constructor(
    private readonly ingestion: WorkInstructionGmailIngestionService = getWorkInstructionServices().ingestion,
    private readonly editAssetCleanup: WorkInstructionEditAssetCleanupService = getWorkInstructionServices().editAssetCleanup
  ) {}

  async start(): Promise<void> {
    if (this.task) {
      logger.warn('[WorkInstructionGmailScheduler] Already running');
      return;
    }
    this.task = cron.schedule(
      WORK_INSTRUCTION_GMAIL_CRON,
      () => {
        void this.runTick();
      },
      { scheduled: true, timezone: 'Asia/Tokyo' }
    );
    logger.info(
      { cron: WORK_INSTRUCTION_GMAIL_CRON },
      '[WorkInstructionGmailScheduler] Five-minute task registered'
    );
  }

  private async runTick(): Promise<void> {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      const config = await BackupConfigLoader.load();
      if (config.workInstructionGmailIngest?.enabled) {
        await this.ingestion.runJobNow({ config, allowWait: false });
      } else {
        logger.debug('[WorkInstructionGmailScheduler] Work-instruction Gmail ingest disabled');
      }
      await this.ingestion.cleanupAssets();
      await this.editAssetCleanup.cleanup();
    } catch (error) {
      logger.error({ err: error }, '[WorkInstructionGmailScheduler] Scheduled tick failed');
    } finally {
      this.tickRunning = false;
    }
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async runOnceForTests(): Promise<void> {
    await this.runTick();
  }
}

let instance: WorkInstructionGmailScheduler | null = null;

export function getWorkInstructionGmailScheduler(): WorkInstructionGmailScheduler {
  if (!instance) instance = new WorkInstructionGmailScheduler();
  return instance;
}

export function resetWorkInstructionGmailSchedulerForTests(): void {
  instance?.stop();
  instance = null;
}
