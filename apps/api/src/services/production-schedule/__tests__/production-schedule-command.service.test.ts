import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import {
  completeProductionScheduleRow,
  setProductionScheduleRowCompletionIntent,
  upsertProductionScheduleDueDate,
  upsertProductionScheduleOrder,
  upsertProductionScheduleProcessingType,
} from '../production-schedule-command.service.js';
import { prisma } from '../../../lib/prisma.js';
import { sharedScheduleFieldsRepository } from '../shared-schedule-fields.repository.js';

const resetSelfInspectionMachineBoardScheduleRowCaches = vi.hoisted(() => vi.fn());

vi.mock('../../part-measurement/self-inspection-machine-board-cache-invalidation.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches,
}));

vi.mock('../shared-schedule-fields.repository.js', () => ({
  sharedScheduleFieldsRepository: {
    findRowNoteByRowId: vi.fn(),
    upsertRowNote: vi.fn(),
    deleteRowNoteByRowId: vi.fn(),
  },
}));

vi.mock('../order-split/production-schedule-unified-order-slot.service.js', () => ({
  acquireUnifiedOrderSlotLockInTransaction: vi.fn(),
  acquireUnifiedOrderSlotLocksInTransaction: vi.fn(),
  assertUnifiedOrderSlotAvailableInTransaction: vi.fn(),
}));

vi.mock('../order-split/production-schedule-parent-row-lock.service.js', () => ({
  acquireProductionScheduleParentRowLockInTransaction: vi.fn(),
}));

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
    productionScheduleOrderSplit: {
      count: vi.fn(),
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
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

describe('production-schedule-command.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma)
    );
    vi.mocked(prisma.productionScheduleOrderSplit.count).mockResolvedValue(0 as never);
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

  it('分割済み行では親行の手動順番設定を常に拒否する', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-split-parent',
      rowData: { FSIGENCD: 'R01' }
    } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.productionScheduleOrderSplit.count).mockResolvedValue(1 as never);

    await expect(
      upsertProductionScheduleOrder({
        rowId: 'row-split-parent',
        locationKey: 'kiosk-1',
        resourceCd: 'R01',
        orderNumber: 2
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PARENT_ORDER_NOT_ALLOWED_FOR_SPLIT_ROW'
    } satisfies Partial<ApiError>);

    expect(prisma.productionScheduleOrderAssignment.upsert).not.toHaveBeenCalled();
  });

  it('intent=complete が既に完了なら unchanged で tx を叩かない', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-done',
      rowData: { FSEIBAN: 'S1', progress: '' },
    } as never);
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      isCompleted: true,
    } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null as never);

    const result = await setProductionScheduleRowCompletionIntent({
      rowId: 'row-done',
      locationKey: 'kiosk-1',
      intent: 'complete',
    });

    expect(result.unchanged).toBe(true);
    expect(result.rowData.progress).toBe('完了');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('upsertProductionScheduleDueDate invalidates self-inspection machine board schedule row cache', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-1',
      rowData: {},
    } as never);
    vi.mocked(sharedScheduleFieldsRepository.findRowNoteByRowId).mockResolvedValue(null);
    vi.mocked(sharedScheduleFieldsRepository.upsertRowNote).mockResolvedValue(undefined as never);

    await upsertProductionScheduleDueDate({
      rowId: 'row-1',
      dueDateText: '2026-06-15',
      locationKey: 'kiosk-1',
    });

    expect(resetSelfInspectionMachineBoardScheduleRowCaches).toHaveBeenCalledTimes(1);
  });
});
