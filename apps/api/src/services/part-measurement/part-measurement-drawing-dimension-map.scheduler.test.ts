import { describe, expect, it, vi } from 'vitest';

vi.mock('./part-measurement-drawing-dimension-map.service.js', () => ({ getPartMeasurementDrawingDimensionMapService: vi.fn() }));
vi.mock('./part-measurement-drawing-placement.service.js', () => ({ getPartMeasurementDrawingPlacementService: vi.fn() }));
vi.mock('./part-measurement-drawing-placement-jev-reorder.js', () => ({ createPlacementJevReorderProvider: vi.fn(() => null) }));

import { PartMeasurementDrawingDimensionMapScheduler } from './part-measurement-drawing-dimension-map.scheduler.js';
import { createPlacementJevReorderProvider } from './part-measurement-drawing-placement-jev-reorder.js';

describe('dimension map scheduler placement backfill', () => {
  it('creates a fresh provider budget for every nightly run and passes null when disabled', async () => {
    vi.mocked(createPlacementJevReorderProvider).mockClear();
    const service = { discoverTargets: vi.fn(), runBatch: vi.fn() };
    const placement = { backfill: vi.fn() };
    const scheduler = new PartMeasurementDrawingDimensionMapScheduler(service as never, '20 0-5 * * *', 4, 100, undefined, placement as never, 30);
    await scheduler.runOnce();
    await scheduler.runOnce();
    expect(createPlacementJevReorderProvider).toHaveBeenCalledTimes(2);
    expect(service.runBatch).toHaveBeenCalledWith({ batchSize: 4, signal: expect.any(AbortSignal) });
    expect(placement.backfill).toHaveBeenCalledWith(30, null);
  });
  it('runs placement after the map batch and passes the optional reorder provider', async () => {
    const order: string[] = [];
    const service = {
      discoverTargets: vi.fn(async () => { order.push('discover'); }),
      runBatch: vi.fn(async () => { order.push('map'); })
    };
    const placement = { backfill: vi.fn(async () => { order.push('placement'); }) };
    const provider = vi.fn(() => null);
    const scheduler = new PartMeasurementDrawingDimensionMapScheduler(service as never, '20 0-5 * * *', 4, 100, provider, placement as never, 30);
    await scheduler.runOnce();
    expect(order).toEqual(['discover', 'map', 'placement']);
    expect(service.runBatch).toHaveBeenCalledWith({ batchSize: 4, signal: expect.any(AbortSignal) });
    expect(placement.backfill).toHaveBeenCalledWith(30, provider);
  });

  it('contains placement failure and releases the running guard for the next batch', async () => {
    const service = { discoverTargets: vi.fn(), runBatch: vi.fn() };
    const placement = { backfill: vi.fn().mockRejectedValue(new Error('placement unavailable')) };
    const scheduler = new PartMeasurementDrawingDimensionMapScheduler(service as never, '20 0-5 * * *', 4, 100, null, placement as never, 30);
    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(service.runBatch).toHaveBeenCalledTimes(2);
    expect(service.runBatch).toHaveBeenCalledWith({ batchSize: 4, signal: expect.any(AbortSignal) });
    expect(placement.backfill).toHaveBeenCalledWith(30, null);
  });
});
