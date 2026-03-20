import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import {
  completeProductionScheduleRow,
  upsertProductionScheduleOrder,
  upsertProductionScheduleProcessingType,
} from '../production-schedule-command.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    csvDashboardRow: {
      findFirst: vi.fn(),
    },
    productionScheduleProgress: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    productionScheduleOrderAssignment: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    productionScheduleRowNote: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    productionScheduleProcessingTypeOption: {
      findMany: vi.fn(),
    },
    dueManagementOutcomeEvent: {
      create: vi.fn()
    },
    $transaction: vi.fn(),
  },
}));

describe('production-schedule-command.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.productionScheduleProcessingTypeOption.findMany).mockResolvedValue([
      {
        code: '塗装',
        label: '塗装',
        enabled: true,
        priority: 10,
      },
    ] as never);
  });

  it('complete対象が存在しない場合は404を返す', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue(null);

    await expect(
      completeProductionScheduleRow({
        rowId: 'missing-row',
        locationKey: 'kiosk-1',
      })
    ).rejects.toThrow(ApiError);
    await expect(
      completeProductionScheduleRow({
        rowId: 'missing-row',
        locationKey: 'kiosk-1',
      })
    ).rejects.toThrow('対象の行が見つかりません');
  });

  it('無効なprocessingTypeは400を返す', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-1',
    } as never);

    await expect(
      upsertProductionScheduleProcessingType({
        rowId: 'row-1',
        locationKey: 'kiosk-1',
        processingType: 'invalid-type',
      })
    ).rejects.toThrow(ApiError);
    await expect(
      upsertProductionScheduleProcessingType({
        rowId: 'row-1',
        locationKey: 'kiosk-1',
        processingType: 'invalid-type',
      })
    ).rejects.toThrow('無効な処理種別です');
  });

  it('行の資源CD不一致時は400を返す', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-2',
      rowData: { FSIGENCD: 'R99' },
    } as never);

    await expect(
      upsertProductionScheduleOrder({
        rowId: 'row-2',
        locationKey: 'kiosk-1',
        resourceCd: 'R01',
        orderNumber: 1,
      })
    ).rejects.toThrow(ApiError);
    await expect(
      upsertProductionScheduleOrder({
        rowId: 'row-2',
        locationKey: 'kiosk-1',
        resourceCd: 'R01',
        orderNumber: 1,
      })
    ).rejects.toThrow('資源CDが一致しません');
  });

  it('orderNumber=null指定時は割当削除してnullを返す', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-3',
      rowData: { FSIGENCD: 'R01' },
    } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.deleteMany).mockResolvedValue({ count: 1 } as never);

    const result = await upsertProductionScheduleOrder({
      rowId: 'row-3',
      locationKey: 'kiosk-1',
      resourceCd: 'R01',
      orderNumber: null,
    });

    expect(result).toEqual({ success: true, orderNumber: null });
    expect(prisma.productionScheduleOrderAssignment.deleteMany).toHaveBeenCalledWith({
      where: {
        csvDashboardRowId: 'row-3',
        location: 'kiosk-1'
      }
    });
  });

  it('手動順番 upsert で siteKey が保存される', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-site',
      rowData: { FSIGENCD: 'R01' }
    } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.upsert).mockResolvedValue({} as never);

    await upsertProductionScheduleOrder({
      rowId: 'row-site',
      locationKey: '第2工場 - kioskA',
      resourceCd: 'R01',
      orderNumber: 2
    });

    expect(prisma.productionScheduleOrderAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          location: '第2工場 - kioskA',
          siteKey: '第2工場'
        }),
        update: expect.objectContaining({
          siteKey: '第2工場'
        })
      })
    );
  });
});

