import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { GmailRateLimitedDeferredError } from '../backup/gmail-request-gate.service.js';
import {
  getMachineSignalGmailIngestionService,
  hasGmailCredentials,
  type MachineSignalGmailIngestionService,
} from './machine-signal-gmail-ingestion.service.js';

/**
 * 日報メールは1日1通。届く時刻が決まっていないので毎時確認する（メールが無ければ検索1回だけ）。
 * CSV取り込みとは排他を共有しないが、Gmail の利用枠と冷却は共有するので、
 * 定時のCSV取り込み（毎時12分・42分、06:25 など）と重ならない50分に置く。
 */
export const MACHINE_SIGNAL_GMAIL_CRON = process.env.MACHINE_SIGNAL_GMAIL_CRON?.trim() || '50 * * * *';

export class MachineSignalGmailScheduler {
  private task: cron.ScheduledTask | null = null;

  constructor(private readonly ingestion: MachineSignalGmailIngestionService = getMachineSignalGmailIngestionService()) {}

  start(): void {
    if (this.task) return;
    if (!cron.validate(MACHINE_SIGNAL_GMAIL_CRON)) {
      logger?.warn({ cron: MACHINE_SIGNAL_GMAIL_CRON }, '[MachineSignalGmailScheduler] Invalid cron schedule, not started');
      return;
    }
    this.task = cron.schedule(MACHINE_SIGNAL_GMAIL_CRON, () => void this.runScheduled(), {
      scheduled: true,
      timezone: 'Asia/Tokyo',
    });
  }

  async runScheduled(): Promise<void> {
    try {
      const config = await BackupConfigLoader.load();
      if (!hasGmailCredentials(config)) return;
      const summary = await this.ingestion.runOnce({ config, allowWait: false });
      if (summary.processed > 0) {
        logger?.info(
          { processed: summary.processed, imported: summary.runs.reduce((sum, run) => sum + run.importedCount, 0) },
          '[MachineSignalGmailScheduler] Imported daily reports'
        );
      }
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        logger?.info({ cooldownUntil: error.cooldownUntil }, '[MachineSignalGmailScheduler] Deferred by Gmail cooldown');
        return;
      }
      logger?.error({ err: error }, '[MachineSignalGmailScheduler] Scheduled import failed');
    }
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }
}

let instance: MachineSignalGmailScheduler | null = null;

export function getMachineSignalGmailScheduler(): MachineSignalGmailScheduler {
  instance ??= new MachineSignalGmailScheduler();
  return instance;
}
