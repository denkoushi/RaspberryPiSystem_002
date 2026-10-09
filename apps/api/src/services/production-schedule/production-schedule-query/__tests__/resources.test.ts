import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../lib/prisma.js';
import { getResourceCategoryPolicy } from '../../policies/resource-category-policy.service.js';
import { getResourceNameMapByResourceCds } from '../../resource-master.service.js';
import { listProductionScheduleResources, resetProductionScheduleResourceCdsCache } from '../resources.js';

vi.mock('../../../../lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('../../policies/resource-category-policy.service.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../policies/resource-category-policy.service.js')>(),
  getResourceCategoryPolicy: vi.fn(),
}));
vi.mock('../../resource-master.service.js', () => ({ getResourceNameMapByResourceCds: vi.fn() }));

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

  it('reloads at the five minute TTL boundary', async () => {
    await listProductionScheduleResources({});
    vi.advanceTimersByTime(ttl - 1);
    await listProductionScheduleResources({});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await listProductionScheduleResources({});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
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
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('query failed'));
    await expect(listProductionScheduleResources({})).rejects.toThrow('query failed');
    await expect(listProductionScheduleResources({})).resolves.toHaveProperty('resources', ['R01', 'R02']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('reloads after explicit invalidation', async () => {
    await listProductionScheduleResources({});
    resetProductionScheduleResourceCdsCache();
    await listProductionScheduleResources({});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
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
