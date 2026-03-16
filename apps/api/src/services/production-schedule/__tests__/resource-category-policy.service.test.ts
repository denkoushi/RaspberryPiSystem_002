import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  filterProductionScheduleResourceCdsByCategoryWithPolicy,
  getResourceCategoryPolicy,
  isProductionScheduleCuttingResourceCd,
  isProductionScheduleExcludedCuttingResourceCd,
  resolveResourceCategorySiteResolution,
  resolveResourceCategorySiteKey
} from '../policies/resource-category-policy.service.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleResourceCategoryConfig: {
      findUnique: vi.fn()
    }
  }
}));

describe('resource-category-policy.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses default cutting exclusions when no config exists', async () => {
    vi.mocked(prisma.productionScheduleResourceCategoryConfig.findUnique).mockResolvedValue(null);
    const policy = await getResourceCategoryPolicy({ deviceScopeKey: 'Test' });
    expect(policy.cuttingExcludedResourceCds).toEqual(['10', 'MSZ']);
  });

  it('resolves resource category site key from device scope and explicit scope', () => {
    expect(resolveResourceCategorySiteKey({ deviceScopeKey: '第2工場 - kensakuMain' })).toBe('第2工場');
    expect(resolveResourceCategorySiteKey({ deviceScopeKey: '第2工場 - RoboDrill01' })).toBe('第2工場');
    expect(resolveResourceCategorySiteKey({ siteKey: 'shared' })).toBe('shared');
  });

  it('returns resolution source for migration monitoring', () => {
    expect(resolveResourceCategorySiteResolution({ siteKey: 'shared' })).toEqual({
      siteKey: 'shared',
      source: 'siteKey'
    });
    expect(resolveResourceCategorySiteResolution({ deviceScopeKey: '第2工場 - kensakuMain' })).toEqual({
      siteKey: '第2工場',
      source: 'deviceScopeKey'
    });
    expect(resolveResourceCategorySiteResolution({})).toEqual({
      siteKey: 'default',
      source: 'default'
    });
  });

  it('queries config using normalized site key', async () => {
    vi.mocked(prisma.productionScheduleResourceCategoryConfig.findUnique).mockResolvedValue({
      cuttingExcludedResourceCds: ['X01']
    } as unknown as Awaited<ReturnType<typeof prisma.productionScheduleResourceCategoryConfig.findUnique>>);

    await getResourceCategoryPolicy({ deviceScopeKey: '第2工場 - kensakuMain' });

    expect(prisma.productionScheduleResourceCategoryConfig.findUnique).toHaveBeenCalledWith({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: '第2工場'
        }
      },
      select: {
        cuttingExcludedResourceCds: true
      }
    });
  });

  it('applies cutting category filtering with exclusions', () => {
    const policy = {
      grindingResourceCds: ['305'],
      cuttingExcludedResourceCds: ['10', 'MSZ']
    };
    expect(isProductionScheduleCuttingResourceCd('100', policy)).toBe(true);
    expect(isProductionScheduleCuttingResourceCd('10', policy)).toBe(false);
    expect(isProductionScheduleCuttingResourceCd('msz', policy)).toBe(false);
    expect(isProductionScheduleCuttingResourceCd('305', policy)).toBe(false);
    expect(isProductionScheduleExcludedCuttingResourceCd('  msz ', policy)).toBe(true);
    const filtered = filterProductionScheduleResourceCdsByCategoryWithPolicy(
      ['305', '100', '10', 'MSZ'],
      'cutting',
      policy
    );
    expect(filtered).toEqual(['100']);
  });
});
