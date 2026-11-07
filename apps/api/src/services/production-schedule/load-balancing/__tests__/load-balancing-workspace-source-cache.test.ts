import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));
import { logger } from '../../../../lib/logger.js';
import {
  buildLoadBalancingWorkspaceSourceBaseKey,
  buildLoadBalancingWorkspaceSourceKey,
  clearLoadBalancingWorkspaceSourceCacheForTests,
  readLoadBalancingWorkspaceSourceWithCache as read,
  registerLoadBalancingWorkspaceSourceWarmer,
  startLoadBalancingWorkspaceSourceWarmer
} from '../load-balancing-workspace-source-cache.js';

const scope = { siteKey: 'site', deviceScopeKey: 'device', dueSource: 'excel' as const, fromMonth: '2026-11', toMonth: '2026-12' };
const baseKey = buildLoadBalancingWorkspaceSourceBaseKey(scope);
const key = buildLoadBalancingWorkspaceSourceKey({ ...scope, today: '2026-11-07' });
const source = (label: string) => ({ queryRows: [], machineNames: { S1: label } });
function deferred() {
  let resolve!: (value: ReturnType<typeof source>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof source>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const params = (token: string, load = vi.fn().mockResolvedValue(source(token))) => ({ key, baseKey, generationToken: token, load });

describe('workspace source cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T00:00:00Z'));
    clearLoadBalancingWorkspaceSourceCacheForTests();
    vi.clearAllMocks();
  });
  afterEach(() => {
    clearLoadBalancingWorkspaceSourceCacheForTests();
    vi.useRealTimers();
  });

  it('returns miss then fresh and shares concurrent cold loads', async () => {
    const pending = deferred();
    const load = vi.fn(() => pending.promise);
    const a = read(params('g1', load));
    const b = read(params('g1', load));
    pending.resolve(source('g1'));
    expect((await a).cacheState).toBe('miss');
    expect((await a).cacheHit).toBe(false);
    expect((await b).cacheHit).toBe(true);
    expect((await b).source).toBe((await a).source);
    expect((await read(params('g1', load))).cacheState).toBe('fresh');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('returns stale immediately, shares background loads, then becomes fresh', async () => {
    await read(params('g1'));
    const pending = deferred();
    const load = vi.fn(() => pending.promise);
    const stale = await read(params('g2', load));
    expect(stale.cacheState).toBe('stale');
    expect(stale.cacheHit).toBe(true);
    expect(stale.source.machineNames.S1).toBe('g1');
    const second = await read(params('g2', load));
    pending.resolve(source('g2'));
    await Promise.all([stale.revalidation, second.revalidation]);
    expect((await read(params('g2'))).cacheState).toBe('fresh');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('logs failed background loads and retains stale until the next request retries', async () => {
    await read(params('g1'));
    const load = vi.fn().mockRejectedValue(new Error('db down'));
    const stale = await read(params('g2', load));
    await stale.revalidation;
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    const retried = await read(params('g2', load));
    expect(retried.source.machineNames.S1).toBe('g1');
    await retried.revalidation;
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('discards an older generation completing after a newer one', async () => {
    await read(params('g1'));
    const old = deferred();
    const stale = await read(params('g2', vi.fn(() => old.promise)));
    const newer = await read(params('g3'));
    await newer.revalidation;
    old.resolve(source('g2'));
    await stale.revalidation;
    const result = await read(params('g3'));
    expect(result.cacheState).toBe('fresh');
    expect(result.source.machineNames.S1).toBe('g3');
  });

  it('uses a thirty-minute fresh TTL and a six-hour maximum stale age', async () => {
    await read(params('g1'));
    vi.advanceTimersByTime(30 * 60_000 - 1);
    expect((await read(params('g1'))).cacheState).toBe('fresh');
    vi.advanceTimersByTime(1);
    const pending = deferred();
    const stale = await read(params('g1', vi.fn(() => pending.promise)));
    expect(stale.cacheState).toBe('stale');
    vi.advanceTimersByTime(330 * 60_000);
    const miss = read(params('g1'));
    pending.resolve(source('updated'));
    await stale.revalidation;
    expect((await miss).cacheState).toBe('miss');
  });

  it('keeps due sources separate and returns stale when only today changes', async () => {
    await read(params('g1'));
    const tomorrowKey = buildLoadBalancingWorkspaceSourceKey({ ...scope, today: '2026-11-08' });
    const tomorrow = await read({ ...params('g1'), key: tomorrowKey });
    expect(tomorrow.cacheState).toBe('stale');
    await tomorrow.revalidation;
    const scaw = { ...scope, dueSource: 'scaw' as const };
    expect((await read({ ...params('g1'), key: buildLoadBalancingWorkspaceSourceKey({ ...scaw, today: '2026-11-08' }), baseKey: buildLoadBalancingWorkspaceSourceBaseKey(scaw) })).cacheState).toBe('miss');
  });

  it('evicts the least recently used base key above sixteen entries', async () => {
    for (let i = 0; i < 16; i++) await read({ ...params('g1'), key: String(i), baseKey: String(i) });
    await read({ ...params('g1'), key: '0', baseKey: '0' });
    await read({ ...params('g1'), key: '16', baseKey: '16' });
    expect((await read({ ...params('g1'), key: '0', baseKey: '0' })).cacheState).toBe('fresh');
    expect((await read({ ...params('g1'), key: '1', baseKey: '1' })).cacheState).toBe('miss');
  });

  it('retries a failed cold load', async () => {
    await expect(read(params('g1', vi.fn().mockRejectedValue(new Error('db down'))))).rejects.toThrow('db down');
    expect((await read(params('g1'))).cacheState).toBe('miss');
  });

  it('warms changed tokens and dates every minute, stops after three inactive hours', async () => {
    await read(params('g1'));
    let token = 'g2';
    let today = '2026-11-07';
    const load = vi.fn().mockResolvedValue(source('warmed'));
    const prepare = vi.fn(async () => ({ ...params(token, load), key: buildLoadBalancingWorkspaceSourceKey({ ...scope, today }) }));
    registerLoadBalancingWorkspaceSourceWarmer(baseKey, prepare);
    // Test environments do not start the timer implicitly.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prepare).not.toHaveBeenCalled();
    startLoadBalancingWorkspaceSourceWarmer();
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await read(params('g2'))).cacheState).toBe('fresh');
    expect(load).toHaveBeenCalledTimes(1);
    token = 'g3';
    today = '2026-11-08';
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await read({ ...params('g3'), key: buildLoadBalancingWorkspaceSourceKey({ ...scope, today }) })).cacheState).toBe('fresh');
    vi.advanceTimersByTime(3 * 60 * 60_000);
    const count = prepare.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prepare).toHaveBeenCalledTimes(count);
  });

  it('runs warmers sequentially and prevents overlapping timer ticks', async () => {
    const pending = deferred();
    const first = vi.fn(() => pending.promise);
    const second = vi.fn().mockResolvedValue(source('second'));
    registerLoadBalancingWorkspaceSourceWarmer('a', async () => ({ ...params('g1', first), baseKey: 'a' }));
    registerLoadBalancingWorkspaceSourceWarmer('b', async () => ({ ...params('g1', second), baseKey: 'b' }));
    startLoadBalancingWorkspaceSourceWarmer();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    pending.resolve(source('first'));
    await vi.advanceTimersByTimeAsync(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
