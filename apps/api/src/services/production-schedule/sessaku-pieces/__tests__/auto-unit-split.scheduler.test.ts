import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), split: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('../../../../lib/logger.js', () => ({ logger: { info: mocks.info, warn: mocks.warn } }));
vi.mock('../auto-unit-split.service.js', () => ({ autoSplitSessakuUnits: mocks.split }));
import { createSessakuAutoUnitSplitScheduler, wakeSessakuAutoUnitSplit } from '../auto-unit-split.scheduler.js';

describe('sessaku background splitting', () => {
  let scheduler: ReturnType<typeof createSessakuAutoUnitSplitScheduler>;
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    mocks.query.mockResolvedValue([{ siteKey: '' }, { siteKey: 'site-a' }, { siteKey: 'site-b' }]);
    mocks.split.mockResolvedValue({ splitCount: 0, skippedCount: 0, hasMore: false });
    scheduler = createSessakuAutoUnitSplitScheduler();
  });
  afterEach(async () => { await scheduler.stop(); vi.useRealTimers(); vi.unstubAllEnvs(); });
  it('advances without a page, repeats hasMore quickly, then polls slowly for newly eligible lots', async () => {
    mocks.split.mockResolvedValueOnce({ splitCount: 1, skippedCount: 0, hasMore: true });
    scheduler.start(); scheduler.start();
    await vi.advanceTimersByTimeAsync(29999); expect(mocks.split).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(mocks.split).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0][0].sql).toContain('UNION');
    expect(mocks.split.mock.calls.map(([p]) => p.siteKey)).toEqual(['site-a', 'site-b']);
    await vi.advanceTimersByTimeAsync(1000); expect(mocks.split).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(59999); expect(mocks.split).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1); expect(mocks.split).toHaveBeenCalledTimes(6);
  });
  it.each(['runner_busy', 'P2028', 'AUTO_UNIT_SPLIT_CANDIDATE_TIMEOUT', 'exception'] as const)('waits after %s instead of busy looping', async (reason) => {
    if (reason === 'exception') mocks.split.mockRejectedValue(new Error('unavailable'));
    else mocks.split.mockImplementation(async ({ onYield }) => {
      onYield(reason); return { splitCount: 0, skippedCount: 0, hasMore: true };
    });
    scheduler.start(); await vi.advanceTimersByTimeAsync(30000);
    const count = mocks.split.mock.calls.length;
    await vi.advanceTimersByTimeAsync(59999); expect(mocks.split).toHaveBeenCalledTimes(count);
    await vi.advanceTimersByTimeAsync(1); expect(mocks.split.mock.calls.length).toBeGreaterThan(count);
  });
  it('continues to all other sites after one site fails', async () => {
    mocks.query.mockResolvedValue([{ siteKey: 'failed' }, { siteKey: 'next' }, { siteKey: 'last' }]);
    mocks.split.mockRejectedValueOnce(new Error('one site failed'));
    scheduler.start(); await vi.advanceTimersByTimeAsync(30000);
    expect(mocks.split.mock.calls.map(([p]) => p.siteKey)).toEqual(['failed', 'next', 'last']);
    await vi.advanceTimersByTimeAsync(1000); expect(mocks.split).toHaveBeenCalledTimes(3);
  });
  it('coalesces wake signals, never overlaps and drains the in-flight round on stop', async () => {
    let release!: () => void;
    mocks.split.mockReturnValueOnce(new Promise(resolve => { release = () => resolve({ splitCount: 1, skippedCount: 0, hasMore: true }); }));
    scheduler.start(); wakeSessakuAutoUnitSplit(); wakeSessakuAutoUnitSplit();
    await vi.advanceTimersByTimeAsync(1000); expect(mocks.split).toHaveBeenCalledTimes(1);
    wakeSessakuAutoUnitSplit(); await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.split).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    release(); await stop; expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(60000); expect(mocks.split).toHaveBeenCalledTimes(1);
    wakeSessakuAutoUnitSplit(); await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.split).toHaveBeenCalledTimes(1);
  });
  it('does nothing when creation is disabled or no scheduler is running', async () => {
    wakeSessakuAutoUnitSplit(); await vi.advanceTimersByTimeAsync(60000);
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'false'); scheduler.start();
    wakeSessakuAutoUnitSplit(); await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.split).not.toHaveBeenCalled();
  });
});
