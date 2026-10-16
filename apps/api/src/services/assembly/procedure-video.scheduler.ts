import cron from 'node-cron';

import { env } from '../../config/env.js';
import { getProcedureVideoAutoEditService, recoverProcedureVideoAutoEdit } from './procedure-video-auto-edit.service.js';

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
    if (env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED) {
      void recoverProcedureVideoAutoEdit().then(() => getProcedureVideoAutoEditService().runOnce()).catch((error: unknown) => {
        logger.error({ err: error }, 'Procedure video auto edit failed');
      });
    }
    void getProcedureVideoProcessingService().runOnce().catch((error: unknown) => {
      logger.error({ err: error }, 'Procedure video processing failed');
    });
  }
}
let scheduler: ProcedureVideoScheduler | undefined;
export function getProcedureVideoScheduler() { return scheduler ??= new ProcedureVideoScheduler(); }
