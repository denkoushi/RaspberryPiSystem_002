import { describe, expect, it, vi } from 'vitest';

import { FkojunstMailSupersededPruneScheduler } from '../fkojunst-status-mail-superseded-prune.scheduler.js';

describe('FkojunstMailSupersededPruneScheduler', () => {
  it('runs the prune in execute mode with the per-run limit', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'over_limit', deleteCandidates: 200_000, winners: 1, maxDelete: 20_000 });
    const scheduler = new FkojunstMailSupersededPruneScheduler(run as never);

    await scheduler.runTick();

    expect(run).toHaveBeenCalledWith({ mode: 'execute', maxDelete: 20_000 });
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
