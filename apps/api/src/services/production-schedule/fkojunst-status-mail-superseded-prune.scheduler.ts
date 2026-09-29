import cron from 'node-cron';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

import { runFkojunstMailSupersededPrune } from './fkojunst-status-mail-superseded-prune.service.js';

/** FKOJUNST_Status mail raw の上書き済み旧行を夜間に削除する。1 回の上限を超える大量削除は手動スクリプトで行う。 */
export class FkojunstMailSupersededPruneScheduler {
  private task: cron.ScheduledTask | null = null;
  private active: Promise<void> | null = null;

  constructor(private readonly run: typeof runFkojunstMailSupersededPrune = runFkojunstMailSupersededPrune) {}

  start(): void {
    if (this.task || !env.FKOJUNST_MAIL_PRUNE_ENABLED) return;
    this.task = cron.schedule(env.FKOJUNST_MAIL_PRUNE_CRON, () => void this.runTick(), { timezone: 'Asia/Tokyo' });
    logger.info({ cron: env.FKOJUNST_MAIL_PRUNE_CRON }, '[FkojunstMailSupersededPruneScheduler] registered');
  }

  async runTick(): Promise<void> {
    if (this.active) return;
    this.active = (async () => {
      try {
        const result = await this.run({ mode: 'execute', maxDelete: env.FKOJUNST_MAIL_PRUNE_MAX_DELETE });
        logger.info(
          { status: result.status, deleteCandidates: result.deleteCandidates, winners: result.winners },
          '[FkojunstMailSupersededPruneScheduler] tick completed'
        );
      } catch (error) {
        logger.error({ err: error }, '[FkojunstMailSupersededPruneScheduler] tick failed');
      }
    })().finally(() => {
      this.active = null;
    });
    await this.active;
  }

  async stop(): Promise<void> {
    this.task?.stop();
    this.task = null;
    await this.active;
  }
}

const scheduler = new FkojunstMailSupersededPruneScheduler();
export const getFkojunstMailSupersededPruneScheduler = (): FkojunstMailSupersededPruneScheduler => scheduler;
