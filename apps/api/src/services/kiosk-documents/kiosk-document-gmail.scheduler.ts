import cron from 'node-cron';
import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { KioskDocumentGmailIngestionService } from './kiosk-document-gmail-ingestion.service.js';

/**
 * 要領書Gmail取り込みのcron登録（backup.json の kioskDocumentGmailIngest）
 */
export class KioskDocumentGmailScheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private isRunning = false;
  private readonly ingestion: KioskDocumentGmailIngestionService;

  constructor(ingestion?: KioskDocumentGmailIngestionService) {
    this.ingestion = ingestion ?? new KioskDocumentGmailIngestionService();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger?.warn('[KioskDocumentGmailScheduler] Already running');
      return;
    }
    const config = await BackupConfigLoader.load();
    const schedules = config.kioskDocumentGmailIngest ?? [];

    if (schedules.length === 0) {
      logger?.info('[KioskDocumentGmailScheduler] No kioskDocumentGmailIngest schedules configured');
      return;
    }

    this.isRunning = true;

    for (const schedule of schedules) {
      if (!schedule.enabled || !schedule.schedule) {
        continue;
      }
      const taskId = schedule.id;
      const existing = this.tasks.get(taskId);
      existing?.stop();

      if (!cron.validate(schedule.schedule)) {
        logger?.warn(
          { taskId, schedule: schedule.schedule },
          '[KioskDocumentGmailScheduler] Invalid cron schedule, skipping'
        );
        continue;
      }

      const task = cron.schedule(
        schedule.schedule,
        async () => {
          try {
            const latest = await BackupConfigLoader.load();
            const entry = (latest.kioskDocumentGmailIngest ?? []).find((s) => s.id === taskId);
            if (!entry?.enabled) {
              return;
            }
            await this.ingestion.ingestSchedule({ config: latest, schedule: entry });
          } catch (error) {
            logger?.error({ err: error, taskId }, '[KioskDocumentGmailScheduler] Scheduled ingest failed');
          }
        },
        { scheduled: true, timezone: 'Asia/Tokyo' }
      );
      this.tasks.set(taskId, task);
      logger?.info(
        { taskId, name: schedule.name, cron: schedule.schedule },
        '[KioskDocumentGmailScheduler] Task registered'
      );
    }
  }

  stop(): void {
    for (const [taskId, task] of this.tasks.entries()) {
      task.stop();
      logger?.info({ taskId }, '[KioskDocumentGmailScheduler] Task stopped');
    }
    this.tasks.clear();
    this.isRunning = false;
  }

  async reload(): Promise<void> {
    this.stop();
    await this.start();
  }
}

let instance: KioskDocumentGmailScheduler | null = null;

export function getKioskDocumentGmailScheduler(): KioskDocumentGmailScheduler {
  if (!instance) {
    instance = new KioskDocumentGmailScheduler();
  }
  return instance;
}
