import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  filterProductionScheduleResourceCdsByCategoryWithPolicy,
  getResourceCategoryPolicy,
  isProductionScheduleCuttingResourceCd
} from '../policies/resource-category-policy.service.js';
import { prisma } from '../../../lib/prisma.js';

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
    const policy = await getResourceCategoryPolicy('Test');
    expect(policy.cuttingExcludedResourceCds).toEqual(['10', 'MSZ']);
  });

  it('applies cutting category filtering with exclusions', () => {
    const policy = {
      grindingResourceCds: ['305'],
      cuttingExcludedResourceCds: ['10', 'MSZ']
    };
    expect(isProductionScheduleCuttingResourceCd('100', policy)).toBe(true);
    expect(isProductionScheduleCuttingResourceCd('10', policy)).toBe(false);
    expect(isProductionScheduleCuttingResourceCd('305', policy)).toBe(false);
    const filtered = filterProductionScheduleResourceCdsByCategoryWithPolicy(
      ['305', '100', '10', 'MSZ'],
      'cutting',
      policy
    );
    expect(filtered).toEqual(['100']);
  });
});
