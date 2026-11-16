import { beforeEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';

import { ProductionSchedulePartNameLookupScheduler } from '../production-schedule-part-name-lookup.scheduler.js';

vi.mock('../production-schedule-part-name-lookup-rebuild.js', () => ({ requestProductionSchedulePartNameLookupRebuild: vi.fn() }));

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

describe('part name lookup scheduler', () => {
  beforeEach(() => vi.resetAllMocks());
  it('registers one daily JST job and stops it', async () => {
    const stop = vi.fn();
    vi.mocked(cron.schedule).mockReturnValue({ stop } as never);
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ProductionSchedulePartNameLookupScheduler(run);
    scheduler.start(); scheduler.start();
    expect(cron.schedule).toHaveBeenCalledOnce();
    expect(cron.schedule).toHaveBeenCalledWith('35 3 * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    await scheduler.runTick(); expect(run).toHaveBeenCalledOnce();
    await scheduler.stop(); expect(stop).toHaveBeenCalledOnce();
  });
  it('prevents overlap and waits for active cleanup during stop', async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const scheduler = new ProductionSchedulePartNameLookupScheduler(run);
    const first = scheduler.runTick();
    await scheduler.runTick(); expect(run).toHaveBeenCalledOnce();
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    finish(); await first; await stopping; expect(stopped).toBe(true);
    const next = scheduler.runTick(); finish(); await next;
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('catches cleanup errors and releases the running guard', async () => {
    const run = vi.fn().mockRejectedValue(new Error('DB down'));
    const scheduler = new ProductionSchedulePartNameLookupScheduler(run);
    await expect(scheduler.runTick()).resolves.toBeUndefined();
    await scheduler.runTick(); expect(run).toHaveBeenCalledTimes(2);
  });
});
