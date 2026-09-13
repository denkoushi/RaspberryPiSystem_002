import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { BusinessHermesNightlyService } from './business-hermes-nightly.service.js';

class BusinessHermesNightlyScheduler {
  private task: cron.ScheduledTask | null = null;
  private abort: AbortController | null = null;
  private active: Promise<unknown> | null = null;
  start() {
    if (this.task || env.BUSINESS_HERMES_NIGHTLY_ENABLED !== 'true') return;
    if (!env.BUSINESS_HERMES_NIGHTLY_DATA_DIR || !env.BUSINESS_HERMES_ANSWER_CACHE_URL || !env.BUSINESS_HERMES_ANSWER_CACHE_TOKEN) throw new Error('Incomplete Hermes nightly configuration');
    this.task = cron.schedule('0 3 * * *', () => {
      if (this.active) return;
      this.abort = new AbortController();
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(20 * 60_000)]);
      this.active = new BusinessHermesNightlyService().run(signal)
        .then(result => logger.info({ runId: result.runId, status: result.status }, 'Hermes nightly check completed'))
        .catch(error => logger.error({ error: error instanceof Error ? error.name : 'unknown' }, 'Hermes nightly check failed'))
        .finally(() => { this.active = null; this.abort = null; });
    }, { timezone: 'Asia/Tokyo' });
  }
  async stop() {
    this.task?.stop(); this.task = null;
    this.abort?.abort();
    await this.active;
  }
}
const scheduler = new BusinessHermesNightlyScheduler();
export const getBusinessHermesNightlyScheduler = () => scheduler;
