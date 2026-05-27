import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../../lib/logger.js';
import { prisma } from '../../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import {
  listLoadBalancingCapacityBase,
  listLoadBalancingCapacityBaseResolved,
  listLoadBalancingClassesResolved,
  listLoadBalancingMonthlyCapacityResolved,
  listLoadBalancingTransferRulesResolved,
  listLoadBalancingWorkCalendarsResolved
} from '../load-balancing-settings.service.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleResourceCapacityBase: { findMany: vi.fn() },
    productionScheduleResourceMonthlyCapacity: { findMany: vi.fn() },
    productionScheduleLoadBalanceClass: { findMany: vi.fn() },
    productionScheduleLoadBalanceTransferRule: { findMany: vi.fn() },
    productionScheduleResourceWorkCalendar: { findMany: vi.fn() }
  }
}));

vi.mock('../../../../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

const siteWhere = (siteKey: string) => ({
  where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey },
  orderBy: [{ resourceCd: 'asc' as const }],
  select: { resourceCd: true, baseAvailableMinutes: true }
});

describe('load-balancing-settings.service (resolved readers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listLoadBalancingCapacityBase は siteKey 完全一致のみ返す', async () => {
    vi.mocked(prisma.productionScheduleResourceCapacityBase.findMany).mockResolvedValueOnce([
      { resourceCd: '021', baseAvailableMinutes: 100 }
    ]);

    const result = await listLoadBalancingCapacityBase('第2工場');

    expect(prisma.productionScheduleResourceCapacityBase.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      siteKey: '第2工場',
      items: [{ resourceCd: '021', baseAvailableMinutes: 100 }]
    });
  });

  it('capacityBaseResolved: shared 補完時は debug のみ', async () => {
    const findManyMock = vi.mocked(prisma.productionScheduleResourceCapacityBase.findMany);
    findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { resourceCd: '021', baseAvailableMinutes: 75600 }
    ]);

    await listLoadBalancingCapacityBaseResolved('第2工場');

    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('capacityBaseResolved: site/shared とも空のとき warn', async () => {
    vi.mocked(prisma.productionScheduleResourceCapacityBase.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listLoadBalancingCapacityBaseResolved('第2工場');

    expect(result.items).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('capacityBaseResolved: site 優先で shared 不足分補完', async () => {
    vi.mocked(prisma.productionScheduleResourceCapacityBase.findMany)
      .mockResolvedValueOnce([{ resourceCd: '021', baseAvailableMinutes: 100 }])
      .mockResolvedValueOnce([
        { resourceCd: '021', baseAvailableMinutes: 999 },
        { resourceCd: '033', baseAvailableMinutes: 50 }
      ]);

    const result = await listLoadBalancingCapacityBaseResolved('第2工場');

    expect(result.items).toEqual([
      { resourceCd: '021', baseAvailableMinutes: 100 },
      { resourceCd: '033', baseAvailableMinutes: 50 }
    ]);
  });

  it('capacityBaseResolved: shared 直読時は二重参照しない', async () => {
    vi.mocked(prisma.productionScheduleResourceCapacityBase.findMany).mockResolvedValueOnce([
      { resourceCd: '021', baseAvailableMinutes: 75600 }
    ]);

    await listLoadBalancingCapacityBaseResolved('shared');

    expect(prisma.productionScheduleResourceCapacityBase.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleResourceCapacityBase.findMany).toHaveBeenCalledWith(siteWhere('shared'));
  });

  it('monthlyCapacityResolved: shared 補完と site 優先', async () => {
    vi.mocked(prisma.productionScheduleResourceMonthlyCapacity.findMany)
      .mockResolvedValueOnce([{ resourceCd: '021', availableMinutes: 200 }])
      .mockResolvedValueOnce([{ resourceCd: '033', availableMinutes: 50 }]);

    const result = await listLoadBalancingMonthlyCapacityResolved({
      siteKeyInput: '第2工場',
      yearMonth: '2026-05'
    });

    expect(prisma.productionScheduleResourceMonthlyCapacity.findMany).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([
      { resourceCd: '021', availableMinutes: 200 },
      { resourceCd: '033', availableMinutes: 50 }
    ]);
    expect(logger.debug).toHaveBeenCalled();
  });

  it('classesResolved: shared のみから補完', async () => {
    vi.mocked(prisma.productionScheduleLoadBalanceClass.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ resourceCd: '021', classCode: 'G1' }]);

    const result = await listLoadBalancingClassesResolved('第2工場');

    expect(result.items).toEqual([{ resourceCd: '021', classCode: 'G1' }]);
  });

  it('transferRulesResolved: site が同一キーで上書き、別 priority は残る', async () => {
    vi.mocked(prisma.productionScheduleLoadBalanceTransferRule.findMany)
      .mockResolvedValueOnce([
        {
          fromClassCode: 'G1',
          toClassCode: 'G2',
          priority: 2,
          enabled: true,
          efficiencyRatio: 1
        }
      ])
      .mockResolvedValueOnce([
        {
          fromClassCode: 'G1',
          toClassCode: 'G2',
          priority: 1,
          enabled: false,
          efficiencyRatio: 2
        },
        {
          fromClassCode: 'G1',
          toClassCode: 'G3',
          priority: 1,
          enabled: true,
          efficiencyRatio: 1
        }
      ]);

    const result = await listLoadBalancingTransferRulesResolved('第2工場');

    expect(result.items).toHaveLength(3);
    const g2Rules = result.items.filter((item) => item.toClassCode === 'G2');
    expect(g2Rules.map((item) => item.priority).sort()).toEqual([1, 2]);
    expect(g2Rules.some((item) => item.priority === 2 && item.enabled)).toBe(true);
    expect(result.items.some((item) => item.toClassCode === 'G3' && item.priority === 1)).toBe(true);
  });

  it('workCalendarsResolved: shared 直読時は二重参照しない', async () => {
    vi.mocked(prisma.productionScheduleResourceWorkCalendar.findMany).mockResolvedValueOnce([
      { resourceCd: '021', workCalendarMode: 'weekdays' }
    ]);

    await listLoadBalancingWorkCalendarsResolved('shared');

    expect(prisma.productionScheduleResourceWorkCalendar.findMany).toHaveBeenCalledTimes(1);
  });
});
