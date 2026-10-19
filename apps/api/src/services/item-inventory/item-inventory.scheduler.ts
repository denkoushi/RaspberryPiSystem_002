import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { getItemInventoryServices } from './item-inventory-service.factory.js';

export const ITEM_INVENTORY_GMAIL_CRON = '*/5 * * * *';

export class ItemInventoryScheduler {
  private task: cron.ScheduledTask | null = null;
  private tickRunning = false;

  constructor(private readonly ingestion = getItemInventoryServices().ingestion) {}

  async start(): Promise<void> {
    if (this.task) {
      logger.warn('[ItemInventoryScheduler] Already running');
      return;
    }
    this.task = cron.schedule(ITEM_INVENTORY_GMAIL_CRON, () => { void this.runTick(); }, { scheduled: true, timezone: 'Asia/Tokyo' });
    logger.info({ cron: ITEM_INVENTORY_GMAIL_CRON }, '[ItemInventoryScheduler] Five-minute task registered');
  }

  private async runTick(): Promise<void> {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      const config = await BackupConfigLoader.load();
      if (config.itemInventoryGmailIngest?.enabled) {
        await this.ingestion.runOnce({ config, allowWait: false });
      }
    } catch (error) {
      logger.error({ err: error }, '[ItemInventoryScheduler] Scheduled tick failed');
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

let instance: ItemInventoryScheduler | null = null;

export function getItemInventoryScheduler(): ItemInventoryScheduler {
  if (!instance) instance = new ItemInventoryScheduler();
  return instance;
}

export function resetItemInventorySchedulerForTests(): void {
  instance?.stop();
  instance = null;
}
