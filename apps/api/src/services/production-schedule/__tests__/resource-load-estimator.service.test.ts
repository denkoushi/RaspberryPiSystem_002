import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), policy: vi.fn() }));

vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('../row-resolver/index.js', () => ({ buildMaxProductNoWinnerCondition: () => Prisma.sql`TRUE` }));
vi.mock('../policies/resource-category-policy.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../policies/resource-category-policy.service.js')>()),
  getResourceCategoryPolicy: mocks.policy
}));

import { estimateResourceLoadSignals } from '../resource-load-estimator.service.js';

const row = (fseiban: string, resourceCd: string, processCount: number, totalRequiredMinutes: number | null) => ({
  fseiban,
  resourceCd,
  processCount: BigInt(processCount),
  totalRequiredMinutes
});

describe('estimateResourceLoadSignals', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.policy.mockReset().mockResolvedValue({ grindingResourceCds: ['305'], cuttingExcludedResourceCds: ['10', 'MSZ'] });
  });

  it('returns an empty map without querying when there are no candidates', async () => {
    const result = await estimateResourceLoadSignals({ locationKey: 'loc', candidateFseibans: ['', '  '] });
    expect(result.size).toBe(0);
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('resolves the resource category policy with the location key as device scope', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await estimateResourceLoadSignals({ locationKey: 'kiosk-9', candidateFseibans: ['A'] });
    expect(mocks.policy).toHaveBeenCalledWith({ deviceScopeKey: 'kiosk-9' });
  });

  it('computes concentration, bottleneck and crowded ratios across candidates', async () => {
    mocks.queryRaw.mockResolvedValue([
      row('A', 'R1', 2, 100),
      row('A', 'R2', 1, 50),
      row('B', 'r1 ', 3, 200),
      row('B', 'R3', 1, 10),
      // excluded cutting resource: must not count for B nor for totals
      row('B', ' 10 ', 7, 999),
      row('B', 'msz', 7, 999)
    ]);
    const result = await estimateResourceLoadSignals({ locationKey: 'loc', candidateFseibans: [' A ', 'B', 'C', 'A'] });

    expect(Array.from(result.keys())).toEqual(['A', 'B', 'C']);

    // resource totals: R1=300, R2=50, R3=10 -> crowded threshold (75th pct index) = 50, bottleneck = 300
    const a = result.get('A')!;
    expect(a.unfinishedProcessCount).toBe(3);
    expect(a.resourceTypeCount).toBe(2);
    expect(a.concentrationRatio).toBeCloseTo(100 / 150);
    expect(a.bottleneckLoadRatio).toBeCloseTo(100 / 300);
    expect(a.crowdedLoadRatio).toBeCloseTo(1);

    const b = result.get('B')!;
    expect(b.unfinishedProcessCount).toBe(4);
    expect(b.resourceTypeCount).toBe(2);
    expect(b.concentrationRatio).toBeCloseTo(200 / 210);
    expect(b.bottleneckLoadRatio).toBeCloseTo(200 / 300);
    expect(b.crowdedLoadRatio).toBeCloseTo(200 / 210);

    expect(result.get('C')).toEqual({
      unfinishedProcessCount: 0,
      resourceTypeCount: 0,
      concentrationRatio: 0,
      bottleneckLoadRatio: 0,
      crowdedLoadRatio: 0
    });
  });

  it('returns zero ratios (no NaN) when required minutes are null or zero', async () => {
    mocks.queryRaw.mockResolvedValue([row('A', 'R1', 4, null), row('A', 'R2', 1, 0)]);
    const result = await estimateResourceLoadSignals({ locationKey: 'loc', candidateFseibans: ['A'] });
    expect(result.get('A')).toEqual({
      unfinishedProcessCount: 5,
      resourceTypeCount: 2,
      concentrationRatio: 0,
      bottleneckLoadRatio: 0,
      crowdedLoadRatio: 0
    });
  });

  it('treats a single resource as both bottleneck and crowded', async () => {
    mocks.queryRaw.mockResolvedValue([row('A', 'R1', 1, 30)]);
    const result = await estimateResourceLoadSignals({ locationKey: 'loc', candidateFseibans: ['A'] });
    expect(result.get('A')).toEqual({
      unfinishedProcessCount: 1,
      resourceTypeCount: 1,
      concentrationRatio: 1,
      bottleneckLoadRatio: 1,
      crowdedLoadRatio: 1
    });
  });

  it('gives an empty signal to a seiban whose only resources are excluded', async () => {
    mocks.queryRaw.mockResolvedValue([row('A', 'MSZ', 3, 100), row('B', 'R1', 1, 10)]);
    const result = await estimateResourceLoadSignals({ locationKey: 'loc', candidateFseibans: ['A', 'B'] });
    expect(result.get('A')?.unfinishedProcessCount).toBe(0);
    expect(result.get('A')?.resourceTypeCount).toBe(0);
    expect(result.get('B')?.bottleneckLoadRatio).toBe(1);
  });

  it('respects policy-provided excluded codes instead of hard-coded defaults', async () => {
    mocks.policy.mockResolvedValue({ grindingResourceCds: [], cuttingExcludedResourceCds: ['R2'] });
    mocks.queryRaw.mockResolvedValue([row('A', 'R1', 1, 10), row('A', 'R2', 1, 90), row('A', '10', 1, 40)]);
    const result = await estimateResourceLoadSignals({ locationKey: 'loc', candidateFseibans: ['A'] });
    const a = result.get('A')!;
    expect(a.resourceTypeCount).toBe(2);
    expect(a.unfinishedProcessCount).toBe(2);
    expect(a.concentrationRatio).toBeCloseTo(40 / 50);
  });
});
