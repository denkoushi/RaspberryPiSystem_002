import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { ProductionActualHoursAggregateService } from '../production-actual-hours-aggregate.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleActualHoursRaw: {
      count: vi.fn(),
    },
    productionScheduleActualHoursCanonical: {
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
    vi.mocked(prisma.productionScheduleActualHoursCanonical.findMany).mockResolvedValue([
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
    vi.mocked(prisma.productionScheduleActualHoursRaw.count).mockResolvedValue(3 as never);

    const service = new ProductionActualHoursAggregateService();
    const result = await service.rebuild({
      locationKey: 'kiosk-1',
      recentDaysExcluded: 30,
      lookbackDays: 5000,
    });

    expect(result.featureKeyCount).toBe(1);
    expect(result.excludedPreFlaggedRows).toBe(1);
    expect(result.totalRawRows).toBe(3);
  });

  it('statsでtotalCanonicalRowsを返し、limitを適用する', async () => {
    vi.mocked(prisma.productionScheduleActualHoursRaw.count).mockResolvedValue(7 as never);
    vi.mocked(prisma.productionScheduleActualHoursCanonical.count).mockResolvedValue(5 as never);
    vi.mocked(prisma.productionScheduleActualHoursFeature.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([
      {
        fhincd: 'PART001',
        resourceCd: 'R01',
        sampleCount: 10,
        medianPerPieceMinutes: 5,
        p75PerPieceMinutes: 8,
        updatedAt: new Date('2024-12-01T00:00:00.000Z'),
      },
    ] as never);

    const service = new ProductionActualHoursAggregateService();
    const stats = await service.getStats({
      locationKey: 'kiosk-1',
      limit: 1,
    });

    expect(stats.totalRawRows).toBe(7);
    expect(stats.totalCanonicalRows).toBe(5);
    expect(stats.totalFeatureKeys).toBe(3);
    expect(stats.topFeatures).toHaveLength(1);
  });
});
