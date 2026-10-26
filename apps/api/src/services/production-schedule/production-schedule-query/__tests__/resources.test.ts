import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../../lib/logger.js';
import { prisma } from '../../../../lib/prisma.js';
import { getResourceCategoryPolicy } from '../../policies/resource-category-policy.service.js';
import { getResourceNameMapByResourceCds, getSendaiResourceCds } from '../../resource-master.service.js';
import {
  listProductionScheduleResources,
  markProductionScheduleResourceCdsCacheStale,
  resetProductionScheduleResourceCdsCache,
} from '../resources.js';

vi.mock('../../../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('../../policies/resource-category-policy.service.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../policies/resource-category-policy.service.js')>(),
  getResourceCategoryPolicy: vi.fn(),
}));
vi.mock('../../resource-master.service.js', () => ({ getResourceNameMapByResourceCds: vi.fn(), getSendaiResourceCds: vi.fn() }));

const rows = [{ resourceCd: 'R01' }, { resourceCd: 'R02' }];
const ttl = 5 * 60 * 1000;

function deferQuery() {
  let resolve!: (value: typeof rows) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof rows>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('production schedule resource codes cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    vi.resetAllMocks();
    resetProductionScheduleResourceCdsCache();
    vi.mocked(prisma.$queryRaw).mockResolvedValue(rows);
    vi.mocked(getResourceCategoryPolicy).mockResolvedValue({ grindingResourceCds: [], cuttingExcludedResourceCds: [] });
    vi.mocked(getResourceNameMapByResourceCds).mockResolvedValue({ R01: ['設備A'] });
    vi.mocked(getSendaiResourceCds).mockResolvedValue(new Set());
  });
  afterEach(() => {
    resetProductionScheduleResourceCdsCache();
    vi.useRealTimers();
  });

  it('shares codes across scopes while reading policy, names and exclusions on every call', async () => {
    const first = await listProductionScheduleResources({ siteKey: 'site-a' });
    vi.mocked(getResourceCategoryPolicy).mockResolvedValue({ grindingResourceCds: [], cuttingExcludedResourceCds: ['R01'] });
    vi.mocked(getResourceNameMapByResourceCds).mockResolvedValue({ R01: ['設備B'] });
    const second = await listProductionScheduleResources({ siteKey: 'site-b', deviceScopeKey: 'kiosk-b' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(getResourceCategoryPolicy).toHaveBeenCalledTimes(2);
    expect(getResourceCategoryPolicy).toHaveBeenLastCalledWith({ siteKey: 'site-b', deviceScopeKey: 'kiosk-b' });
    expect(getResourceNameMapByResourceCds).toHaveBeenCalledTimes(2);
    expect(getResourceNameMapByResourceCds).toHaveBeenLastCalledWith(['R01', 'R02']);
    expect(first.resourceItems[0].excluded).toBe(false);
    expect(second).toEqual({
      resources: ['R01', 'R02'],
      resourceItems: [{ resourceCd: 'R01', excluded: true }, { resourceCd: 'R02', excluded: false }],
      resourceNameMap: { R01: ['設備B'] },
    });
  });

  it('drops Sendai resources but keeps codes missing from the master', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ resourceCd: 'R01' }, { resourceCd: 'a5m ' }, { resourceCd: 'NOMASTER' }]);
    vi.mocked(getSendaiResourceCds).mockResolvedValue(new Set(['A5M']));
    const result = await listProductionScheduleResources({});
    expect(result.resources).toEqual(['R01', 'NOMASTER']);
    expect(result.resourceItems.map((item) => item.resourceCd)).toEqual(['R01', 'NOMASTER']);
    expect(getResourceNameMapByResourceCds).toHaveBeenCalledWith(['R01', 'NOMASTER']);
  });

  it('returns fresh codes without a query within the TTL', async () => {
    await listProductionScheduleResources({});
    vi.advanceTimersByTime(ttl - 1);
    await listProductionScheduleResources({});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('serves stale codes and starts a refresh at the five minute TTL boundary', async () => {
    await listProductionScheduleResources({});
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    vi.advanceTimersByTime(ttl - 1);
    vi.advanceTimersByTime(1);
    expect((await listProductionScheduleResources({})).resources).toEqual(['R01', 'R02']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(ttl);
    deferred.resolve([{ resourceCd: 'NEW' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await listProductionScheduleResources({})).resources).toEqual(['NEW']);
    vi.advanceTimersByTime(ttl - 1);
    expect((await listProductionScheduleResources({})).resources).toEqual(['NEW']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('shares one background refresh across expired callers', async () => {
    await listProductionScheduleResources({});
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    vi.advanceTimersByTime(ttl);
    const results = await Promise.all([
      listProductionScheduleResources({}),
      listProductionScheduleResources({}),
      listProductionScheduleResources({}),
    ]);
    expect(results.map((result) => result.resources)).toEqual(Array(3).fill(['R01', 'R02']));
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    deferred.resolve([{ resourceCd: 'NEW' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await listProductionScheduleResources({})).resources).toEqual(['NEW']);
  });

  it('keeps stale codes and logs a failed refresh, then retries on a later call', async () => {
    await listProductionScheduleResources({});
    const deferred = deferQuery();
    const error = new Error('refresh failed');
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    vi.advanceTimersByTime(ttl);
    expect((await listProductionScheduleResources({})).resources).toEqual(['R01', 'R02']);
    deferred.reject(error);
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { err: error }, 'Failed to refresh production schedule resource codes cache'
    );
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ resourceCd: 'NEW' }]);
    expect((await listProductionScheduleResources({})).resources).toEqual(['R01', 'R02']);
    await vi.advanceTimersByTimeAsync(0);
    expect((await listProductionScheduleResources({})).resources).toEqual(['NEW']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('shares an in-flight query even when it takes longer than the TTL', async () => {
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    const first = listProductionScheduleResources({});
    vi.advanceTimersByTime(ttl);
    const second = listProductionScheduleResources({});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    deferred.resolve(rows);
    expect(await first).toEqual(await second);
    await listProductionScheduleResources({});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed query', async () => {
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    const first = expect(listProductionScheduleResources({})).rejects.toThrow('query failed');
    const second = expect(listProductionScheduleResources({})).rejects.toThrow('query failed');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    deferred.reject(new Error('query failed'));
    await Promise.all([first, second]);
    await expect(listProductionScheduleResources({})).resolves.toHaveProperty('resources', ['R01', 'R02']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('reloads after explicit invalidation', async () => {
    await listProductionScheduleResources({});
    resetProductionScheduleResourceCdsCache();
    await listProductionScheduleResources({});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('serves the last good codes and refreshes after marking stale', async () => {
    await listProductionScheduleResources({});
    markProductionScheduleResourceCdsCacheStale();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    expect((await listProductionScheduleResources({})).resources).toEqual(['R01', 'R02']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    deferred.resolve([{ resourceCd: 'NEW' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await listProductionScheduleResources({})).resources).toEqual(['NEW']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('keeps a refresh result expired when marked stale during the query', async () => {
    await listProductionScheduleResources({});
    vi.advanceTimersByTime(ttl);
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    await listProductionScheduleResources({});
    markProductionScheduleResourceCdsCacheStale();
    expect((await listProductionScheduleResources({})).resources).toEqual(['R01', 'R02']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    deferred.resolve([{ resourceCd: 'PRE_IMPORT' }]);
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ resourceCd: 'POST_IMPORT' }]);
    await listProductionScheduleResources({});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(0);
    expect((await listProductionScheduleResources({})).resources).toEqual(['POST_IMPORT']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it.each(['resolve', 'reject'] as const)('fully clears an initial query when marked stale before it %ss', async (outcome) => {
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    const old = listProductionScheduleResources({});
    const oldResult = outcome === 'reject' ? expect(old).rejects.toThrow('old query failed') : old;
    markProductionScheduleResourceCdsCacheStale();
    await listProductionScheduleResources({});
    if (outcome === 'resolve') deferred.resolve([{ resourceCd: 'OLD' }]);
    else deferred.reject(new Error('old query failed'));
    await oldResult;
    expect((await listProductionScheduleResources({})).resources).toEqual(['R01', 'R02']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)('keeps new codes when a refresh from before reset later %ss', async (outcome) => {
    await listProductionScheduleResources({});
    vi.advanceTimersByTime(ttl);
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    await listProductionScheduleResources({});
    resetProductionScheduleResourceCdsCache();
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ resourceCd: 'NEW' }]);
    expect((await listProductionScheduleResources({})).resources).toEqual(['NEW']);
    if (outcome === 'resolve') deferred.resolve([{ resourceCd: 'OLD' }]);
    else deferred.reject(new Error('old query failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect((await listProductionScheduleResources({})).resources).toEqual(['NEW']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it.each(['resolve', 'reject'] as const)('keeps the new cache when an invalidated query later %ss', async (outcome) => {
    const deferred = deferQuery();
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(deferred.promise as never);
    const old = listProductionScheduleResources({});
    const oldResult = outcome === 'reject' ? expect(old).rejects.toThrow('old query failed') : old;
    resetProductionScheduleResourceCdsCache();
    await listProductionScheduleResources({});
    if (outcome === 'resolve') deferred.resolve([{ resourceCd: 'OLD' }]);
    else deferred.reject(new Error('old query failed'));
    await oldResult;
    expect((await listProductionScheduleResources({})).resources).toEqual(['R01', 'R02']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('caches an empty result and protects cached codes from caller mutations', async () => {
    const result = await listProductionScheduleResources({});
    result.resources.push('extra');
    expect((await listProductionScheduleResources({})).resources).toEqual(['R01', 'R02']);
    resetProductionScheduleResourceCdsCache();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    await listProductionScheduleResources({});
    expect((await listProductionScheduleResources({})).resources).toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
