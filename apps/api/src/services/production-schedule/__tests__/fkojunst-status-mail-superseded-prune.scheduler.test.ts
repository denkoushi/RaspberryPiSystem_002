import { describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';

import { logger } from '../../../lib/logger.js';
import { env } from '../../../config/env.js';
import { FkojunstMailSupersededPruneScheduler } from '../fkojunst-status-mail-superseded-prune.scheduler.js';

describe('FkojunstMailSupersededPruneScheduler', () => {
  it('stays disabled by default until a new production dry-run has been reviewed', () => {
    expect(env.FKOJUNST_MAIL_PRUNE_ENABLED).toBe(false);
    const schedule = vi.spyOn(cron, 'schedule');
    const run = vi.fn();
    new FkojunstMailSupersededPruneScheduler(run as never).start();
    expect(schedule).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    schedule.mockRestore();
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
