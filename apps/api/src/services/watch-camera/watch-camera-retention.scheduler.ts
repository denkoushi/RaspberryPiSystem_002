import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { pruneWatchCameraFrames } from './watch-camera-retention.js';

export class WatchCameraRetentionScheduler {
  private task: cron.ScheduledTask | null = null;
  private active: Promise<void> | null = null;

  constructor(private readonly run: typeof pruneWatchCameraFrames = pruneWatchCameraFrames) {}

  start(): void {
    if (this.task) return;
    this.task = cron.schedule('40 3 * * *', () => void this.runTick(), { timezone: 'Asia/Tokyo' });
  }

  async runTick(): Promise<void> {
    if (this.active) return;
    this.active = (async () => {
      try {
        const result = await this.run();
        logger.info(result, '[WatchCameraRetentionScheduler] Cleanup completed');
      } catch (err) {
        logger.warn({ err }, '[WatchCameraRetentionScheduler] Cleanup failed');
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

const scheduler = new WatchCameraRetentionScheduler();
export const getWatchCameraRetentionScheduler = () => scheduler;
