import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { AdvisoryCheckService } from './advisory-check.service.js';

export class AdvisoryCheckScheduler {
  private task: cron.ScheduledTask | null = null;
  private abort: AbortController | null = null;
  private active: Promise<unknown> | null = null;
  private service: AdvisoryCheckService | null = null;
  start() {
    if (this.task || env.ADVISORY_CHECK_ENABLED !== 'true') return;
    this.task = cron.schedule(env.ADVISORY_CHECK_CRON, () => {
      if (this.active) return;
      this.abort = new AbortController();
      const signal = this.abort.signal;
      this.active = import('../inference/inference-runtime.js').then(({ getInferenceRuntime }) => {
        this.service ??= new AdvisoryCheckService({ dataDir: env.ADVISORY_CHECK_DIR,
          completion: getInferenceRuntime().createTextCompletionPort() });
        return this.service.tick(signal);
      }).catch(error => logger.error({ error: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error) }, 'Advisory check failed'))
        .finally(() => { this.active = null; this.abort = null; });
    }, { timezone: 'Asia/Tokyo' });
  }
  async stop() { this.task?.stop(); this.task = null; this.abort?.abort(); await this.active; }
}
const scheduler = new AdvisoryCheckScheduler();
export const getAdvisoryCheckScheduler = () => scheduler;
