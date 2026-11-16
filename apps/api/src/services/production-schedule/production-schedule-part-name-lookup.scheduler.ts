import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { requestProductionSchedulePartNameLookupRebuild } from './production-schedule-part-name-lookup-rebuild.js';

export class ProductionSchedulePartNameLookupScheduler {
  private task: cron.ScheduledTask | null = null;
  private active: Promise<void> | null = null;

  constructor(private readonly run: typeof requestProductionSchedulePartNameLookupRebuild = requestProductionSchedulePartNameLookupRebuild) {}

  start(): void {
    if (this.task) return;
    // 起動前(migration 適用後の旧 API など)の書き込みや、再起動で消えた依頼の分を取り戻す
    void this.runTick();
    this.task = cron.schedule('35 3 * * *', () => void this.runTick(), { timezone: 'Asia/Tokyo' });
  }

  async runTick(): Promise<void> {
    if (this.active) return;
    this.active = (async () => {
      try {
        // 失敗は作り直しの側でログに残る
        await this.run();
      } catch (err) {
        logger.warn({ err }, '[ProductionSchedulePartNameLookupScheduler] Rebuild failed');
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

const scheduler = new ProductionSchedulePartNameLookupScheduler();
export const getProductionSchedulePartNameLookupScheduler = () => scheduler;
