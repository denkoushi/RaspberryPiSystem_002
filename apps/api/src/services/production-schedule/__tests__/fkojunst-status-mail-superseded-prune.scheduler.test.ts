import { describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';

import { logger } from '../../../lib/logger.js';
import { env } from '../../../config/env.js';
import { FkojunstMailSupersededPruneScheduler } from '../fkojunst-status-mail-superseded-prune.scheduler.js';

describe('FkojunstMailSupersededPruneScheduler', () => {
  it('is enabled by default and registers the nightly cron in Asia/Tokyo', () => {
    expect(env.FKOJUNST_MAIL_PRUNE_ENABLED).toBe(true);
    const schedule = vi.spyOn(cron, 'schedule').mockReturnValue({ stop: vi.fn() } as never);
    const run = vi.fn();
    new FkojunstMailSupersededPruneScheduler(run as never).start();
    expect(schedule).toHaveBeenCalledWith('40 3 * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    expect(run).not.toHaveBeenCalled();
    schedule.mockRestore();
  });

  it('does not register when disabled', () => {
    const schedule = vi.spyOn(cron, 'schedule');
    const original = env.FKOJUNST_MAIL_PRUNE_ENABLED;
    (env as { FKOJUNST_MAIL_PRUNE_ENABLED: boolean }).FKOJUNST_MAIL_PRUNE_ENABLED = false;
    try {
      new FkojunstMailSupersededPruneScheduler(vi.fn() as never).start();
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      (env as { FKOJUNST_MAIL_PRUNE_ENABLED: boolean }).FKOJUNST_MAIL_PRUNE_ENABLED = original;
      schedule.mockRestore();
    }
  });

  it('runs the prune in execute mode with the per-run limit', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'deleted', deleted: 20_000, deleteCandidates: 25_000, winners: 1, hasRemaining: true });
    const scheduler = new FkojunstMailSupersededPruneScheduler(run as never);

    await scheduler.runTick();

    expect(run).toHaveBeenCalledWith({ mode: 'execute', maxDelete: 20_000 });
  });

  it.each([
    { status: 'deleted', deleted: 19_999, reason: 'max delete limit reached before next key', hasRemaining: true },
    { status: 'stopped', deleted: 2_000, reason: 'raw source revision changed', hasRemaining: true },
    { status: 'nothing_to_delete', hasRemaining: false }
  ])('logs deleted, reason and hasRemaining for $status', async (result) => {
    const info = vi.spyOn(logger, 'info');
    const run = vi.fn().mockResolvedValue(result);
    await new FkojunstMailSupersededPruneScheduler(run as never).runTick();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ deleted: result.deleted ?? 0, reason: result.reason ?? null, hasRemaining: result.hasRemaining }),
      '[FkojunstMailSupersededPruneScheduler] tick completed'
    );
    info.mockRestore();
  });

  it('does not overlap ticks and keeps running after a failure', async () => {
    let release: () => void = () => {};
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ status: 'nothing_to_delete' }); }))
      .mockRejectedValueOnce(new Error('boom'));
    const scheduler = new FkojunstMailSupersededPruneScheduler(run as never);

    const first = scheduler.runTick();
    await scheduler.runTick();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;

    await expect(scheduler.runTick()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
