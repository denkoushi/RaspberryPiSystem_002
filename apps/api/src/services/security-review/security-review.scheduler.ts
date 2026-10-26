import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { createSecurityReviewService, RUN_TIMEOUT_MS } from './security-review.service.js';

export class SecurityReviewScheduler {
  private task: cron.ScheduledTask | null = null;
  private abort: AbortController | null = null;
  private active: Promise<unknown> | null = null;
  start() {
    if (this.task || env.SECURITY_REVIEW_NIGHTLY_ENABLED !== 'true') return;
    this.task = cron.schedule(env.SECURITY_REVIEW_NIGHTLY_CRON, () => {
      if (this.active) return;
      this.abort = new AbortController();
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]);
      this.active = createSecurityReviewService(env.SECURITY_REVIEW_DATA_DIR, env.SECURITY_REVIEW_RETRY_UNTIL)
        .then(service => service.run(signal))
        .then(result => logger.info({ status: result?.status ?? 'no_work' }, 'Security review completed'))
        .catch(error => logger.error({ error: error instanceof Error ? error.name : 'unknown',
          message: error instanceof Error ? error.message : String(error) }, 'Security review failed'))
        .finally(() => { this.active = null; this.abort = null; });
    }, { timezone: 'Asia/Tokyo' });
  }
  async stop() {
    this.task?.stop(); this.task = null;
    this.abort?.abort();
    await this.active;
  }
}
const scheduler = new SecurityReviewScheduler();
export const getSecurityReviewScheduler = () => scheduler;
