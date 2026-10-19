import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import {
  getPartMeasurementDrawingDimensionMapService,
  type PartMeasurementDrawingDimensionMapService
} from './part-measurement-drawing-dimension-map.service.js';

/** 夜間だけ DGX を使う（既定は 0〜5 時台の毎時 20 分）。 */
const DEFAULT_SCHEDULE = process.env.PART_MEASUREMENT_DRAWING_DIMENSION_MAP_CRON || '20 0-5 * * *';
const DEFAULT_BATCH_SIZE = Math.min(
  20,
  Math.max(1, Number.parseInt(process.env.PART_MEASUREMENT_DRAWING_DIMENSION_MAP_BATCH_SIZE || '4', 10) || 4)
);
const DEFAULT_DISCOVER_LIMIT = Math.min(
  1000,
  Math.max(1, Number.parseInt(process.env.PART_MEASUREMENT_DRAWING_DIMENSION_MAP_DISCOVER_LIMIT || '100', 10) || 100)
);

const log = logger.child({ component: 'partMeasurementDrawingDimensionMapScheduler' });

export class PartMeasurementDrawingDimensionMapScheduler {
  private task: cron.ScheduledTask | null = null;
  private running = false;
  private abort: AbortController | null = null;

  constructor(
    private readonly service: PartMeasurementDrawingDimensionMapService = getPartMeasurementDrawingDimensionMapService(),
    private readonly schedule = DEFAULT_SCHEDULE,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
    private readonly discoverLimit = DEFAULT_DISCOVER_LIMIT
  ) {}

  start(): void {
    if (this.task) return;
    if (!cron.validate(this.schedule)) {
      log.warn({ schedule: this.schedule }, '[PartMeasurementDrawingDimensionMapScheduler] invalid cron, skip start');
      return;
    }
    this.task = cron.schedule(
      this.schedule,
      async () => {
        await this.runOnce().catch((error) => {
          log.error({ err: error }, '[PartMeasurementDrawingDimensionMapScheduler] run failed');
        });
      },
      { timezone: 'Asia/Tokyo', scheduled: true }
    );
    log.info(
      { schedule: this.schedule, batchSize: this.batchSize, discoverLimit: this.discoverLimit },
      '[PartMeasurementDrawingDimensionMapScheduler] started'
    );
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
    this.abort?.abort();
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    try {
      const discovery = await this.service.discoverTargets({ limit: this.discoverLimit });
      const batch = await this.service.runBatch({ batchSize: this.batchSize, signal: this.abort.signal });
      log.info({ discovery, batch }, '[PartMeasurementDrawingDimensionMapScheduler] run finished');
    } finally {
      this.running = false;
      this.abort = null;
    }
  }
}

let instance: PartMeasurementDrawingDimensionMapScheduler | null = null;

export function getPartMeasurementDrawingDimensionMapScheduler(): PartMeasurementDrawingDimensionMapScheduler {
  if (!instance) {
    instance = new PartMeasurementDrawingDimensionMapScheduler();
  }
  return instance;
}
