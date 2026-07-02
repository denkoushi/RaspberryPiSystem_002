import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import {
  getPartMeasurementDrawingOcrService,
  type PartMeasurementDrawingOcrService
} from './part-measurement-drawing-ocr.service.js';

const DEFAULT_SCHEDULE = process.env.PART_MEASUREMENT_DRAWING_OCR_CRON || '*/10 * * * *';
const DEFAULT_BATCH_SIZE = Math.min(
  10,
  Math.max(1, Number.parseInt(process.env.PART_MEASUREMENT_DRAWING_OCR_BATCH_SIZE || '1', 10) || 1)
);

const log = logger.child({ component: 'partMeasurementDrawingOcrScheduler' });

export class PartMeasurementDrawingOcrScheduler {
  private task: cron.ScheduledTask | null = null;
  private running = false;

  constructor(
    private readonly service: PartMeasurementDrawingOcrService = getPartMeasurementDrawingOcrService(),
    private readonly schedule = DEFAULT_SCHEDULE,
    private readonly batchSize = DEFAULT_BATCH_SIZE
  ) {}

  async start(): Promise<void> {
    if (this.task) return;
    if (!cron.validate(this.schedule)) {
      log.warn({ schedule: this.schedule }, '[PartMeasurementDrawingOcrScheduler] invalid cron, skip start');
      return;
    }
    this.task = cron.schedule(
      this.schedule,
      async () => {
        await this.runOnce().catch((error) => {
          log.error({ err: error }, '[PartMeasurementDrawingOcrScheduler] run failed');
        });
      },
      { timezone: 'Asia/Tokyo', scheduled: true }
    );
    log.info({ schedule: this.schedule, batchSize: this.batchSize }, '[PartMeasurementDrawingOcrScheduler] started');
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.service.runBatch({ batchSize: this.batchSize });
    } finally {
      this.running = false;
    }
  }
}

let instance: PartMeasurementDrawingOcrScheduler | null = null;

export function getPartMeasurementDrawingOcrScheduler(): PartMeasurementDrawingOcrScheduler {
  if (!instance) {
    instance = new PartMeasurementDrawingOcrScheduler();
  }
  return instance;
}
