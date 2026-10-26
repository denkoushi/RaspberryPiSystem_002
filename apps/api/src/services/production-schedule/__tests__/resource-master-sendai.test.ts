import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { getSendaiResourceCds, isSendaiResourceGroupCd } from '../resource-master.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleResourceMaster: { findMany: vi.fn() } } }));
beforeEach(() => vi.resetAllMocks());

describe('Sendai resources', () => {
  it('treats group codes starting with S- as Sendai', () => {
    expect(isSendaiResourceGroupCd(' s-M01-001')).toBe(true);
    expect(isSendaiResourceGroupCd('M-M02-001')).toBe(false);
    expect(isSendaiResourceGroupCd(null)).toBe(false);
  });

  it('returns normalized codes of Sendai resources only', async () => {
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([
      { resourceCd: 'a5m ', resourceGroupCd: 'S-M01-001' },
      { resourceCd: '021', resourceGroupCd: 'M-M02-001' },
      { resourceCd: 'X1', resourceGroupCd: null }
    ] as never);
    expect(await getSendaiResourceCds()).toEqual(new Set(['A5M']));
  });
});
