import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { SecurityReviewQueueService } from './security-review-queue.service.js';

export class SecurityReviewQueueScheduler {
  private task: cron.ScheduledTask | null = null;
  private abort: AbortController | null = null;
  private active: Promise<unknown> | null = null;
  private service: SecurityReviewQueueService | null = null;
  start() {
    if (this.task || env.SECURITY_REVIEW_QUEUE_ENABLED !== 'true') return;
    this.task = cron.schedule(env.SECURITY_REVIEW_QUEUE_CRON, () => {
      if (this.active) return;
      this.abort = new AbortController();
      const signal = this.abort.signal;
      this.active = import('../inference/inference-runtime.js').then(({ getInferenceRuntime }) => {
        this.service ??= new SecurityReviewQueueService({ dataDir: env.SECURITY_REVIEW_DATA_DIR,
          quiet: env.SECURITY_REVIEW_QUEUE_QUIET, completion: getInferenceRuntime().createTextCompletionPort() });
        return this.service.tick(signal);
      }).catch(error => logger.error({ error: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error) }, 'Security review queue failed'))
        .finally(() => { this.active = null; this.abort = null; });
    }, { timezone: 'Asia/Tokyo' });
  }
  async stop() { this.task?.stop(); this.task = null; this.abort?.abort(); await this.active; }
}
const scheduler = new SecurityReviewQueueScheduler();
export const getSecurityReviewQueueScheduler = () => scheduler;
