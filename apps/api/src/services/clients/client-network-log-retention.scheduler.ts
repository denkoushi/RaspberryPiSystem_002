import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { pruneClientNetworkLogs } from './client-network-log-retention.js';

export class ClientNetworkLogRetentionScheduler {
  private task: cron.ScheduledTask | null = null;
  private active: Promise<void> | null = null;

  constructor(private readonly run: typeof pruneClientNetworkLogs = pruneClientNetworkLogs) {}

  start(): void {
    if (this.task) return;
    this.task = cron.schedule('20 3 * * *', () => void this.runTick(), { timezone: 'Asia/Tokyo' });
  }

  async runTick(): Promise<void> {
    if (this.active) return;
    this.active = (async () => {
      try {
        const deleted = await this.run();
        logger.info({ deleted }, '[ClientNetworkLogRetentionScheduler] Cleanup completed');
      } catch (err) {
        logger.warn({ err }, '[ClientNetworkLogRetentionScheduler] Cleanup failed');
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

const scheduler = new ClientNetworkLogRetentionScheduler();
export const getClientNetworkLogRetentionScheduler = () => scheduler;
