import cron, { validate } from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { GmailTrashCleanupService } from './gmail-trash-cleanup.service.js';

export class GmailTrashCleanupScheduler {
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;
  private readonly cleanupService: GmailTrashCleanupService;

  constructor(cleanupService?: GmailTrashCleanupService) {
    this.cleanupService = cleanupService ?? new GmailTrashCleanupService();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger?.warn('[GmailTrashCleanupScheduler] Already running');
      return;
    }

    if (env.GMAIL_TRASH_CLEANUP_ENABLED !== 'true') {
      logger?.info('[GmailTrashCleanupScheduler] Disabled by environment variable');
      return;
    }

    const cleanupSchedule = env.GMAIL_TRASH_CLEANUP_CRON;
    if (!validate(cleanupSchedule)) {
      logger?.warn(
        { schedule: cleanupSchedule },
        '[GmailTrashCleanupScheduler] Invalid cron expression, scheduler will not start'
      );
      return;
    }

    this.task = cron.schedule(
      cleanupSchedule,
      async () => {
        try {
          const result = await this.cleanupService.cleanup({
            processedLabelName: env.GMAIL_TRASH_CLEANUP_LABEL,
            minAgeQuery: env.GMAIL_TRASH_CLEANUP_MIN_AGE,
          });

          if (!result) {
            return;
          }

          logger?.info(
            {
              query: result.query,
              totalMatched: result.totalMatched,
              deletedCount: result.deletedCount,
              errorCount: result.errors.length,
            },
            '[GmailTrashCleanupScheduler] Gmail trash cleanup completed'
          );
        } catch (error) {
          logger?.error({ err: error }, '[GmailTrashCleanupScheduler] Gmail trash cleanup failed');
        }
      },
      {
        scheduled: true,
        timezone: 'Asia/Tokyo',
      }
    );

    this.isRunning = true;
    logger?.info(
      {
        schedule: cleanupSchedule,
        label: env.GMAIL_TRASH_CLEANUP_LABEL,
        minAgeQuery: env.GMAIL_TRASH_CLEANUP_MIN_AGE,
      },
      '[GmailTrashCleanupScheduler] Scheduler started'
    );
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.task) {
      this.task.stop();
      this.task = null;
    }

    this.isRunning = false;
    logger?.info('[GmailTrashCleanupScheduler] Scheduler stopped');
  }
}

let schedulerInstance: GmailTrashCleanupScheduler | null = null;

export function getGmailTrashCleanupScheduler(): GmailTrashCleanupScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new GmailTrashCleanupScheduler();
  }
  return schedulerInstance;
}

