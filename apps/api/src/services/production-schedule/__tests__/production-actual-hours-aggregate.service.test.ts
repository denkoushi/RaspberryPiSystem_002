import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { ProductionActualHoursAggregateService } from '../production-actual-hours-aggregate.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleActualHoursRaw: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    productionScheduleActualHoursFeature: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('production-actual-hours-aggregate.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) =>
      callback({
        productionScheduleActualHoursFeature: {
          deleteMany: vi.fn(),
          createMany: vi.fn(),
        },
      })
    );
  });

  it('除外条件を適用して中央値とp75を集約する', async () => {
    vi.mocked(prisma.productionScheduleActualHoursRaw.findMany).mockResolvedValue([
      {
        fhincd: 'PART001',
        resourceCd: 'R01',
        perPieceMinutes: 10,
        isExcluded: false,
        workDate: new Date('2024-10-01T00:00:00.000Z'),
      },
      {
        fhincd: 'PART001',
        resourceCd: 'R01',
        perPieceMinutes: 20,
        isExcluded: false,
        workDate: new Date('2024-10-02T00:00:00.000Z'),
      },
      {
        fhincd: 'PART001',
        resourceCd: 'R01',
        perPieceMinutes: 0,
        isExcluded: true,
        workDate: new Date('2024-10-03T00:00:00.000Z'),
      },
    ] as never);

    const service = new ProductionActualHoursAggregateService();
    const result = await service.rebuild({
      locationKey: 'kiosk-1',
      recentDaysExcluded: 30,
    });

    expect(result.featureKeyCount).toBe(1);
    expect(result.excludedPreFlaggedRows).toBe(1);
  });
});
