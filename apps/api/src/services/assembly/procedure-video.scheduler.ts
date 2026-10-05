import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { getProcedureVideoProcessingService } from './procedure-video-processing.service.js';

// Started/stopped by the elected scheduler leader with the other post-listen jobs.
export class ProcedureVideoScheduler {
  private task: cron.ScheduledTask | null = null;
  start() {
    if (this.task) return;
    this.task = cron.schedule('* * * * *', () => { this.kick(); }, { timezone: 'Asia/Tokyo', scheduled: true });
  }
  stop() { this.task?.stop(); this.task = null; }
  kick() {
    void getProcedureVideoProcessingService().runOnce().catch((error: unknown) => {
      logger.error({ err: error }, 'Procedure video processing failed');
    });
  }
}
let scheduler: ProcedureVideoScheduler | undefined;
export function getProcedureVideoScheduler() { return scheduler ??= new ProcedureVideoScheduler(); }
