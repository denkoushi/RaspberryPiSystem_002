import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), payload: vi.fn(), load: vi.fn(), warn: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../grinding-planning-board/read.js', () => ({
  warmGrindingPlanningBoardPayload: mocks.payload,
  getGrindingPlanningBoardLoad: mocks.load
}));

import { createGrindingPlanningBoardStartupWarmup } from '../grinding-planning-board/startup-warmup.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';

const createWarmup = (enabled = true) => createGrindingPlanningBoardStartupWarmup({
  enabled, delayMs: 45_000,
  snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 })
});

describe('grinding planning board startup warmup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ siteKey: 'persisted-site' }, { siteKey: 'override-site' }]);
    mocks.payload.mockResolvedValue(undefined);
    mocks.load.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('delays discovery, deduplicates persisted sites in SQL, and warms each request sequentially once', async () => {
    const calls: string[] = [];
    let active = 0;
    const track = (kind: string) => async ({ siteKey, category }: { siteKey: string; category: string }) => {
      expect(active++).toBe(0);
      calls.push(`${siteKey}:${category}:${kind}`);
      await Promise.resolve();
      active--;
    };
    mocks.payload.mockImplementation(track('payload'));
    mocks.load.mockImplementation(track('load'));
    const warmup = createWarmup();
    warmup.start();
    warmup.start();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(mocks.query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]![0].sql).toContain('UNION');
    expect(mocks.query.mock.calls[0]![0].sql).toContain('ProductionScheduleGrindingPlanningBoardOverride');
    expect(calls).toEqual(['persisted-site', 'override-site'].flatMap((site) =>
      ['grinding', 'cutting', 'all'].flatMap((category) => [`${site}:${category}:payload`, `${site}:${category}:load`])));
    expect(mocks.payload).toHaveBeenCalledWith(expect.objectContaining({
      view: 'resource', completionFilter: 'incomplete', includeLoad: false
    }));
    await warmup.stop();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('does no work when disabled or stopped before the delay', async () => {
    const disabled = createWarmup(false);
    const stopped = createWarmup();
    disabled.start();
    stopped.start();
    await stopped.stop();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.payload).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    await disabled.stop();
  });

  it('contains discovery failures without rejecting startup or shutdown', async () => {
    mocks.query.mockRejectedValueOnce(new Error('database unavailable'));
    const warmup = createWarmup();
    expect(() => warmup.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(warmup.stop()).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.payload).not.toHaveBeenCalled();
  });

  it('logs payload and load failures and continues with the remaining work', async () => {
    mocks.payload.mockRejectedValueOnce(new Error('stale generation'));
    mocks.load.mockRejectedValueOnce(new Error('query failed'));
    const warmup = createWarmup();
    warmup.start();
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(warmup.stop()).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.payload).toHaveBeenCalledTimes(6);
    expect(mocks.load).toHaveBeenCalledTimes(6);
  });

  it.each(['query', 'payload', 'load'] as const)('drains an active %s on shutdown without starting subsequent work', async (stage) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks[stage].mockImplementationOnce(async () => {
      await gate;
      return stage === 'query' ? [{ siteKey: 'persisted-site' }] : undefined;
    });
    const warmup = createWarmup();
    warmup.start();
    await vi.advanceTimersByTimeAsync(45_000);
    let drained = false;
    const stopping = warmup.stop().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await stopping;
    expect(mocks.payload).toHaveBeenCalledTimes(stage === 'query' ? 0 : 1);
    expect(mocks.load).toHaveBeenCalledTimes(stage === 'load' ? 1 : 0);
  });
});
