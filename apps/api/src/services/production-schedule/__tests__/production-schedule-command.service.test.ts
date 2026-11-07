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

vi.mock('../grinding-planning-board/source.js', () => ({ readWinnerRowsByLogicalKeyFseibans: vi.fn().mockResolvedValue([]) }));

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

vi.mock('../order-assignment/production-schedule-unified-order-slot.service.js', () => ({
  acquireUnifiedOrderSlotLockInTransaction: vi.fn(),
  acquireUnifiedOrderSlotLocksInTransaction: vi.fn(),
  assertUnifiedOrderSlotAvailableInTransaction: vi.fn(),
}));

vi.mock('../order-assignment/production-schedule-parent-row-lock.service.js', () => ({
  acquireProductionScheduleParentRowLockInTransaction: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    productionScheduleSessakuPieceSet: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    csvDashboardRow: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
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
    productionScheduleOrderSplitAssignment: {
      deleteMany: vi.fn(),
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
    vi.mocked(prisma.productionScheduleOrderSplitAssignment.deleteMany).mockResolvedValue({ count: 0 } as never);
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

  it('旧片が残っていても親の手動順番を保存し、旧 assignment は変更しない', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-parent', rowData: { FSIGENCD: 'R01' }
    } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.productionScheduleOrderSplit.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.upsert).mockResolvedValue({} as never);
    await expect(upsertProductionScheduleOrder({
      rowId: 'row-parent', locationKey: 'kiosk-1', resourceCd: 'R01', orderNumber: 2
    })).resolves.toEqual({ success: true, orderNumber: 2 });
    expect(prisma.productionScheduleOrderSplit.count).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplitAssignment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderAssignment.upsert).toHaveBeenCalled();
  });

  it('片なしで intent=complete が既に完了でもロック後に読み直して unchanged を返す', async () => {
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
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
    expect(prisma.productionScheduleProgress.findUnique).toHaveBeenCalledTimes(1);
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
  it.each([null, { id: 'empty', pieces: [] }])('ordinary/empty-set completion skips board locks and reads Progress after row lock: %j', async (set) => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData: { FSEIBAN: 'A', FHINCD: 'P', FSIGENCD: '1', FKOJUN: '1' } } as never);
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findUnique).mockResolvedValueOnce(set as never);
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({ isCompleted: false } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null);
    if (set) vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'row' }]);
    await completeProductionScheduleRow({ rowId: 'row', locationKey: 'site' });
    expect(prisma.productionScheduleProgress.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { timeout: 30000, maxWait: 15000 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(prisma.$executeRaw).mock.calls[0][1])).toContain('sessaku-pieces:');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(set ? 3 : 2);
    expect(String(vi.mocked(prisma.$queryRaw).mock.calls[1][0])).toContain('CsvDashboardRow');
    const logical = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0];
    const setRead = vi.mocked(prisma.productionScheduleSessakuPieceSet.findUnique).mock.invocationCallOrder[0];
    const rowLock = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[1];
    expect(logical).toBeLessThan(setRead);
    expect(setRead).toBeLessThan(rowLock);
    expect(rowLock).toBeLessThan(vi.mocked(prisma.productionScheduleProgress.findUnique).mock.invocationCallOrder[0]);
    if (set) {
      const winnerRead = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[2];
      expect(rowLock).toBeLessThan(winnerRead);
      expect(winnerRead).toBeLessThan(vi.mocked(prisma.productionScheduleProgress.upsert).mock.invocationCallOrder[0]);
    }
  });
  it.each([{ FSEIBAN: '', FHINCD: 'P' }, { FSEIBAN: '********', FHINCD: 'P' }, { FSEIBAN: 'A', FHINCD: '' }])('completion only locks its own key for unsupported parents %j', async (part) => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData: { ...part, FSIGENCD: '1', FKOJUN: '1' } } as never);
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({ isCompleted: false } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null);
    await completeProductionScheduleRow({ rowId: 'row', locationKey: 'site' });
    expect(prisma.csvDashboardRow.findMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleSessakuPieceSet.findMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('takes board locks only after logical locks and related set detection, before the row lock', async () => {
    const related = { fseiban: 'A', fhincd: 'P', fsigencd: '1', fkojun: '1', id: 'source' };
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData: { FSEIBAN: 'A', FHINCD: 'P', FSIGENCD: '1', FKOJUN: '1' } } as never);
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findMany).mockResolvedValueOnce([related] as never).mockResolvedValueOnce([{ id: 'source' }] as never);
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({ isCompleted: false } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null);
    await completeProductionScheduleRow({ rowId: 'row', locationKey: 'site' });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const logical = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0];
    const board = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[1];
    const relatedRead = vi.mocked(prisma.productionScheduleSessakuPieceSet.findMany).mock.invocationCallOrder[1];
    expect(logical).toBeLessThan(relatedRead);
    expect(relatedRead).toBeLessThan(board);
    expect(String(vi.mocked(prisma.$queryRaw).mock.calls[1][0])).toContain('ProductionScheduleGrindingPlanningBoardState');
    expect(String(vi.mocked(prisma.$queryRaw).mock.calls[2][0])).toContain('CsvDashboardRow');
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[2]).toBeLessThan(vi.mocked(prisma.productionScheduleProgress.findUnique).mock.invocationCallOrder[0]);
  });

});
