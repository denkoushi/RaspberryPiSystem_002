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
const DEFAULT_DISCOVER_LIMIT = Math.min(
  500,
  Math.max(1, Number.parseInt(process.env.PART_MEASUREMENT_DRAWING_OCR_DISCOVER_LIMIT || '100', 10) || 100)
);
const WAKE_DISABLED =
  process.env.PART_MEASUREMENT_DRAWING_OCR_WAKE_DISABLED === 'true' || process.env.NODE_ENV === 'test';

const log = logger.child({ component: 'partMeasurementDrawingOcrScheduler' });

export class PartMeasurementDrawingOcrScheduler {
  private task: cron.ScheduledTask | null = null;
  private running = false;
  private runRequested = false;

  constructor(
    private readonly service: PartMeasurementDrawingOcrService = getPartMeasurementDrawingOcrService(),
    private readonly schedule = DEFAULT_SCHEDULE,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
    private readonly discoverLimit = DEFAULT_DISCOVER_LIMIT
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
    log.info(
      { schedule: this.schedule, batchSize: this.batchSize, discoverLimit: this.discoverLimit },
      '[PartMeasurementDrawingOcrScheduler] started'
    );
    void this.runOnce().catch((error) => {
      log.error({ err: error }, '[PartMeasurementDrawingOcrScheduler] startup run failed');
    });
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async runOnce(): Promise<void> {
    await this.service.discoverBackfillTargets({ limit: this.discoverLimit });
    await this.drainQueue();
  }

  wake(): void {
    if (WAKE_DISABLED) return;
    this.runRequested = true;
    void this.drainQueue().catch((error) => {
      log.error({ err: error }, '[PartMeasurementDrawingOcrScheduler] wake run failed');
    });
  }

  private async drainQueue(): Promise<void> {
    this.runRequested = true;
    if (this.running) return;
    this.running = true;
    try {
      while (this.runRequested) {
        this.runRequested = false;
        await this.service.runBatch({ batchSize: this.batchSize });
      }
    } finally {
      this.running = false;
      if (this.runRequested) {
        void this.drainQueue().catch((error) => {
          log.error({ err: error }, '[PartMeasurementDrawingOcrScheduler] queued wake run failed');
        });
      }
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
