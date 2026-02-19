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
    $transaction: vi.fn(),
  },
}));

describe('production-schedule-command.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        location: 'kiosk-1',
      },
    });
  });
});

