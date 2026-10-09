import { beforeEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';

import { ClientNetworkLogRetentionScheduler } from '../client-network-log-retention.scheduler.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

describe('network retention scheduler', () => {
  beforeEach(() => vi.resetAllMocks());
  it('registers one daily JST job and stops it', async () => {
    const stop = vi.fn();
    vi.mocked(cron.schedule).mockReturnValue({ stop } as never);
    const run = vi.fn().mockResolvedValue(2);
    const scheduler = new ClientNetworkLogRetentionScheduler(run);
    scheduler.start(); scheduler.start();
    expect(cron.schedule).toHaveBeenCalledOnce();
    expect(cron.schedule).toHaveBeenCalledWith('20 3 * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    await scheduler.runTick(); expect(run).toHaveBeenCalledOnce();
    await scheduler.stop(); expect(stop).toHaveBeenCalledOnce();
  });
  it('prevents overlap and waits for active cleanup during stop', async () => {
    let finish!: (count: number) => void;
    const run = vi.fn(() => new Promise<number>((resolve) => { finish = resolve; }));
    const scheduler = new ClientNetworkLogRetentionScheduler(run);
    const first = scheduler.runTick();
    await scheduler.runTick(); expect(run).toHaveBeenCalledOnce();
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    finish(1); await first; await stopping; expect(stopped).toBe(true);
    const next = scheduler.runTick(); finish(1); await next;
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('catches cleanup errors and releases the running guard', async () => {
    const run = vi.fn().mockRejectedValue(new Error('DB down'));
    const scheduler = new ClientNetworkLogRetentionScheduler(run);
    await expect(scheduler.runTick()).resolves.toBeUndefined();
    await scheduler.runTick(); expect(run).toHaveBeenCalledTimes(2);
  });
});
