import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { runLoanPhotoRetention } from './loan-photo-retention.js';

export class LoanPhotoRetentionScheduler {
  private task: cron.ScheduledTask | null = null;
  private active: Promise<void> | null = null;

  constructor(private readonly run: typeof runLoanPhotoRetention = runLoanPhotoRetention) {}

  start(): void {
    if (this.task) return;
    this.task = cron.schedule('50 3 * * *', () => void this.runTick(), { timezone: 'Asia/Tokyo' });
  }

  async runTick(): Promise<void> {
    if (this.active) return;
    this.active = (async () => {
      try {
        await this.run();
      } catch (err) {
        logger.warn({ err }, '[LoanPhotoRetentionScheduler] Cleanup failed');
      }
    })().finally(() => { this.active = null; });
    await this.active;
  }

  async stop(): Promise<void> {
    this.task?.stop();
    this.task = null;
    await this.active;
  }
}

const scheduler = new LoanPhotoRetentionScheduler();
export const getLoanPhotoRetentionScheduler = () => scheduler;
