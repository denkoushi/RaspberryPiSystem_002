import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  getProductionScheduleResourceCategorySettings,
  upsertProductionScheduleResourceCategorySettings
} from '../production-schedule-settings.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleResourceCategoryConfig: {
      findUnique: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

describe('production-schedule-settings.service (resource category)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('siteKey設定が無い場合はshared設定を返す', async () => {
    const findUniqueMock = vi.mocked(prisma.productionScheduleResourceCategoryConfig.findUnique);
    findUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ cuttingExcludedResourceCds: ['KUMITATE2'] });

    const result = await getProductionScheduleResourceCategorySettings('第2工場 - kensakuMain');

    expect(findUniqueMock).toHaveBeenCalledTimes(2);
    expect(findUniqueMock).toHaveBeenNthCalledWith(1, {
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
    expect(findUniqueMock).toHaveBeenNthCalledWith(2, {
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: 'shared'
        }
      },
      select: {
        cuttingExcludedResourceCds: true
      }
    });
    expect(result).toEqual({
      location: '第2工場',
      cuttingExcludedResourceCds: ['KUMITATE2']
    });
  });

  it('保存時にsiteKeyとsharedへ同値を二重保存する', async () => {
    const upsertMock = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) =>
      callback({
        productionScheduleResourceCategoryConfig: {
          upsert: upsertMock
        }
      })
    );
    upsertMock.mockResolvedValue({
      location: '第2工場',
      cuttingExcludedResourceCds: ['KUMITATE2']
    });

    const result = await upsertProductionScheduleResourceCategorySettings({
      location: '第2工場 - kensakuMain',
      cuttingExcludedResourceCds: [' kumitate2 ']
    });

    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(upsertMock).toHaveBeenNthCalledWith(1, {
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: '第2工場'
        }
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: '第2工場',
        cuttingExcludedResourceCds: ['KUMITATE2']
      },
      update: {
        cuttingExcludedResourceCds: ['KUMITATE2']
      },
      select: {
        location: true,
        cuttingExcludedResourceCds: true
      }
    });
    expect(upsertMock).toHaveBeenNthCalledWith(2, {
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: 'shared'
        }
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: 'shared',
        cuttingExcludedResourceCds: ['KUMITATE2']
      },
      update: {
        cuttingExcludedResourceCds: ['KUMITATE2']
      },
      select: {
        location: true,
        cuttingExcludedResourceCds: true
      }
    });
    expect(result).toEqual({
      location: '第2工場',
      cuttingExcludedResourceCds: ['KUMITATE2']
    });
  });

  it('location=shared保存時は二重保存しない', async () => {
    const upsertMock = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) =>
      callback({
        productionScheduleResourceCategoryConfig: {
          upsert: upsertMock
        }
      })
    );
    upsertMock.mockResolvedValue({
      location: 'shared',
      cuttingExcludedResourceCds: ['MSZ']
    });

    await upsertProductionScheduleResourceCategorySettings({
      location: 'shared',
      cuttingExcludedResourceCds: ['MSZ']
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
});
