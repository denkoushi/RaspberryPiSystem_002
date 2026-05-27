import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleResourceCapacityBase: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

import { prisma } from '../../../../lib/prisma.js';
import {
  LOAD_BALANCING_CAPACITY_BASE_SITE_KEY,
  listLoadBalancingCapacityBase,
  replaceLoadBalancingCapacityBase
} from '../load-balancing-settings.service.js';

describe('load-balancing-settings capacity base', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.productionScheduleResourceCapacityBase.findMany).mockResolvedValue([
      { resourceCd: '033', baseAvailableMinutes: 12000 }
    ] as never);
    vi.mocked(prisma.productionScheduleResourceCapacityBase.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.productionScheduleResourceCapacityBase.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback({
        productionScheduleResourceCapacityBase: {
          deleteMany: vi.mocked(prisma.productionScheduleResourceCapacityBase.deleteMany),
          createMany: vi.mocked(prisma.productionScheduleResourceCapacityBase.createMany)
        }
      } as never)
    );
  });

  it('reads shared siteKey regardless of location input', async () => {
    const result = await listLoadBalancingCapacityBase('第2工場 - kensakuMain');

    expect(result.siteKey).toBe(LOAD_BALANCING_CAPACITY_BASE_SITE_KEY);
    expect(prisma.productionScheduleResourceCapacityBase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteKey: LOAD_BALANCING_CAPACITY_BASE_SITE_KEY
        })
      })
    );
    expect(result.items).toEqual([{ resourceCd: '033', baseAvailableMinutes: 12000 }]);
  });

  it('writes shared siteKey regardless of location input', async () => {
    const result = await replaceLoadBalancingCapacityBase({
      siteKeyInput: '第2工場',
      items: [{ resourceCd: '060', baseAvailableMinutes: 8000 }]
    });

    expect(result.siteKey).toBe(LOAD_BALANCING_CAPACITY_BASE_SITE_KEY);
    expect(prisma.productionScheduleResourceCapacityBase.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteKey: LOAD_BALANCING_CAPACITY_BASE_SITE_KEY
        })
      })
    );
    expect(prisma.productionScheduleResourceCapacityBase.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            siteKey: LOAD_BALANCING_CAPACITY_BASE_SITE_KEY,
            resourceCd: '060',
            baseAvailableMinutes: 8000
          })
        ])
      })
    );
  });
});
