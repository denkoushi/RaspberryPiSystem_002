import { syncWholePiecesOperationCompletions } from '../sessaku-pieces/piece-operation-definitions.js';
import { readOverrides } from '../grinding-planning-board/source.js';
const completionMocks = vi.hoisted(() => ({ quantities: vi.fn(), progress: vi.fn() }));
vi.mock('../sessaku-pieces/piece-operation-definitions.js', () => ({ syncWholePiecesOperationCompletions: vi.fn() }));
vi.mock('../sessaku-pieces/piece-quantity.js', () => ({ reconcileSessakuPieceQuantities: completionMocks.quantities }));
vi.mock('../sessaku-pieces/piece-completion.js', () => ({ reconcileSessakuPieceProgress: completionMocks.progress }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import {
  completeProductionScheduleRow,
  setProductionScheduleRowCompletionIntent,
  upsertProductionScheduleDueDate,
  upsertProductionScheduleNote,
  upsertProductionScheduleOrder,
  upsertProductionScheduleProcessingType,
} from '../production-schedule-command.service.js';
import { releaseOrderAssignmentAtLocation } from '../order-assignment/order-assignment-release.repository.js';
import { prisma } from '../../../lib/prisma.js';
import { sharedScheduleFieldsRepository } from '../shared-schedule-fields.repository.js';
import { acquireProductionScheduleParentRowLockInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';

vi.mock('@prisma/client', async () => {
  const { sqltag, join, raw, empty, PrismaClientKnownRequestError } = await import('@prisma/client/runtime/client');
  return { Prisma: { sql: sqltag, join, raw, empty, PrismaClientKnownRequestError } };
});

vi.mock('../order-assignment/order-assignment-release.repository.js', () => ({
  releaseOrderAssignmentAtLocation: vi.fn().mockResolvedValue({ shiftCount: 0 })
}));

vi.mock('../grinding-planning-board/source.js', () => ({ readWinnerRowsByLogicalKeyFseibans: vi.fn().mockResolvedValue([]), readOverrides: vi.fn().mockResolvedValue(new Map()) }));

const resetSelfInspectionMachineBoardScheduleRowCaches = vi.hoisted(() => vi.fn());

vi.mock('../../part-measurement/self-inspection-machine-board-cache-invalidation.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches,
}));

vi.mock('../shared-schedule-fields.repository.js', () => ({
  sharedScheduleFieldsRepository: {
    findRowNoteByRowId: vi.fn(),
    upsertRowNote: vi.fn(),
    updateRowNoteFields: vi.fn(),
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
    productionScheduleSessakuPieceSet: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    productionScheduleSessakuPiece: { updateMany: vi.fn() },
    productionScheduleSessakuPieceOpCompletion: { findMany: vi.fn().mockResolvedValue([]) },
    productionScheduleSessakuPieceAuditLog: { create: vi.fn() },
    productionScheduleExternalCompletion: { findUnique: vi.fn().mockResolvedValue(null) },
    productionScheduleOrderSupplement: { findFirst: vi.fn().mockResolvedValue(null) },
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
    productionScheduleDueDateAuditLog: { create: vi.fn() },
    productionScheduleRowNote: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
    vi.mocked(prisma.$executeRaw).mockReset();
    vi.mocked(acquireProductionScheduleParentRowLockInTransaction).mockReset();
    vi.mocked(sharedScheduleFieldsRepository.findRowNoteByRowId).mockReset();
    vi.mocked(sharedScheduleFieldsRepository.upsertRowNote).mockReset();
    vi.mocked(sharedScheduleFieldsRepository.updateRowNoteFields).mockReset();
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

  it.each([
    ['note', 'new note'], ['note', ''], ['processingType', '塗装'], ['processingType', '']
  ] as const)('%s 保存のロック取得後に納期保存が始まっても両方の値を保持する: %s', async (field, value) => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData: {} } as never);
    let stored: { note: string; processingType: string | null; dueDate: Date | null } | null = {
      note: field === 'note' ? 'old note' : '', processingType: field === 'processingType' ? '塗装' : null, dueDate: null
    };
    let releaseLock!: () => void;
    let lockStarted!: () => void;
    const firstLock = new Promise<void>((resolve) => { lockStarted = resolve; });
    const resumeLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    let tail = Promise.resolve();
    const unlocks = new Map<unknown, () => void>();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => {
      const tx = { ...prisma };
      try { return await callback(tx); } finally { unlocks.get(tx)?.(); }
    });
    vi.mocked(acquireProductionScheduleParentRowLockInTransaction).mockImplementation(async (tx) => {
      const previous = tail;
      tail = new Promise<void>((resolve) => { unlocks.set(tx, resolve); });
      await previous;
      if (unlocks.size === 1) { lockStarted(); await resumeLock; }
    });
    vi.mocked(sharedScheduleFieldsRepository.findRowNoteByRowId).mockImplementation(async () => {
      const snapshot = stored ? { ...stored } : null;
      return snapshot as never;
    });
    vi.mocked(sharedScheduleFieldsRepository.upsertRowNote).mockImplementation(async (input) => {
      stored = { note: '', processingType: null, dueDate: null, ...stored, ...input };
      return stored as never;
    });
    vi.mocked(sharedScheduleFieldsRepository.updateRowNoteFields).mockImplementation(async (_rowId, fields) => {
      if (stored) Object.assign(stored, fields);
      return { count: stored ? 1 : 0 };
    });
    vi.mocked(prisma.$executeRaw).mockImplementation(async () => {
      if (stored && !stored.note && !stored.processingType && !stored.dueDate) stored = null;
      return 1;
    });
    const saving = field === 'note'
      ? upsertProductionScheduleNote({ rowId: 'row', locationKey: 'site', note: value })
      : upsertProductionScheduleProcessingType({ rowId: 'row', locationKey: 'site', processingType: value });
    await firstLock;
    const dueSaving = upsertProductionScheduleDueDate({ rowId: 'row', locationKey: 'site', dueDateText: '2026-11-20' });
    // Give the competing save time to reach the row lock (or finish on the old implementation).
    await new Promise((resolve) => setImmediate(resolve));
    releaseLock();
    await Promise.all([saving, dueSaving]);
    expect(stored).toMatchObject({
      note: field === 'note' ? value : '',
      processingType: field === 'processingType' ? value || null : null,
      dueDate: new Date('2026-11-20T00:00:00.000Z')
    });
    expect(acquireProductionScheduleParentRowLockInTransaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000
    });
    for (const [, tx] of vi.mocked(sharedScheduleFieldsRepository.findRowNoteByRowId).mock.calls) {
      expect(tx).toBeDefined();
    }
  });

  it.each([
    { note: 'new note' }, { processingType: '塗装' }, { processingType: null },
    { dueDate: new Date('2026-11-20') }, { dueDate: null }
  ])('共有欄の部分upsertは指定した欄だけを更新する: %j', async (fields) => {
    const { sharedScheduleFieldsRepository: repository } = await vi.importActual<typeof import('../shared-schedule-fields.repository.js')>(
      '../shared-schedule-fields.repository.js'
    );
    await repository.upsertRowNote({ csvDashboardId: 'dashboard', csvDashboardRowId: 'row', ...fields }, prisma);
    const args = vi.mocked(prisma.productionScheduleRowNote.upsert).mock.calls[0][0];
    expect(Object.fromEntries(Object.entries(args.update).filter(([, value]) => value !== undefined))).toEqual(fields);
    expect(args.create).toEqual({
      csvDashboardId: 'dashboard', csvDashboardRowId: 'row', note: '', dueDate: null, processingType: null, ...fields
    });
  });

  it.each([{ note: '' }, { dueDate: null }, { processingType: null }])('共有欄のクリアは指定した列だけをupdateManyする: %j', async (fields) => {
    const { sharedScheduleFieldsRepository: repository } = await vi.importActual<typeof import('../shared-schedule-fields.repository.js')>(
      '../shared-schedule-fields.repository.js'
    );
    await repository.updateRowNoteFields('row', fields, prisma);
    expect(prisma.productionScheduleRowNote.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { csvDashboardRowId: 'row' }, data: fields
    });
  });

  it.each(['note', 'processingType', 'dueDate'] as const)('%s を消すと自分の列だけ更新してDB条件で空行を削除する', async (field) => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData: {} } as never);
    vi.mocked(sharedScheduleFieldsRepository.findRowNoteByRowId).mockResolvedValue({
      note: field === 'note' ? 'old' : '', processingType: field === 'processingType' ? '塗装' : null,
      dueDate: field === 'dueDate' ? new Date('2026-11-20') : null
    } as never);
    if (field === 'note') await upsertProductionScheduleNote({ rowId: 'row', locationKey: 'site', note: '' });
    if (field === 'processingType') await upsertProductionScheduleProcessingType({ rowId: 'row', locationKey: 'site', processingType: '' });
    if (field === 'dueDate') await upsertProductionScheduleDueDate({ rowId: 'row', locationKey: 'site', dueDateText: '' });
    expect(sharedScheduleFieldsRepository.updateRowNoteFields).toHaveBeenCalledExactlyOnceWith('row', { [field]: field === 'note' ? '' : null }, prisma);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [sql, rowId] = vi.mocked(prisma.$executeRaw).mock.calls[0];
    expect(String(sql)).toContain('DELETE FROM "ProductionScheduleRowNote"');
    expect(String(sql)).toContain('"dueDate" IS NULL');
    expect(String(sql)).toContain('BTRIM("note"');
    expect(String(sql)).toContain('BTRIM("processingType"');
    expect(rowId).toBe('row');
    expect(prisma.productionScheduleRowNote.deleteMany).not.toHaveBeenCalled();
    expect(sharedScheduleFieldsRepository.upsertRowNote).not.toHaveBeenCalled();
    expect(vi.mocked(acquireProductionScheduleParentRowLockInTransaction).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(sharedScheduleFieldsRepository.updateRowNoteFields).mock.invocationCallOrder[0]);
  });

  it('存在しない納期日を400で拒否する', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData: {} } as never);
    await expect(upsertProductionScheduleDueDate({ rowId: 'row', locationKey: 'site', dueDateText: '2026-02-30' }))
      .rejects.toMatchObject({ statusCode: 400, message: '納期日はYYYY-MM-DD形式で入力してください' });
    expect(sharedScheduleFieldsRepository.upsertRowNote).not.toHaveBeenCalled();
  });

  it('完了はtransaction内の親行ロック後に割当を読み、直前に追加された枠も解放する', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData: {} } as never);
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({ isCompleted: false } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null);
    const assignment = { id: 'assignment', resourceCd: 'R01', orderNumber: 1 };
    const findUnique = vi.fn().mockResolvedValue(assignment);
    const tx = { ...prisma, productionScheduleOrderAssignment: { ...prisma.productionScheduleOrderAssignment, findUnique } };
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(tx));
    const result = await completeProductionScheduleRow({ rowId: 'row', locationKey: 'site', debugSessionId: '30be23' });
    expect(prisma.productionScheduleOrderAssignment.findUnique).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalled();
    expect(vi.mocked(acquireProductionScheduleParentRowLockInTransaction).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(tx.$queryRaw).mock.invocationCallOrder[0]);
    expect(vi.mocked(tx.$queryRaw).mock.invocationCallOrder[0])
      .toBeLessThan(findUnique.mock.invocationCallOrder[0]);
    expect(releaseOrderAssignmentAtLocation).toHaveBeenCalledExactlyOnceWith(tx, { csvDashboardRowId: 'row', location: 'site' });
    expect(result.debug).toMatchObject({ hadAssignment: true, findAssignmentMs: expect.any(Number) });
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
  it.each(['complete', 'incomplete'] as const)('parent-row %s uses the same whole-piece operation synchronizer, including effective resources', async (intent) => {
    const rowData = { FSEIBAN: 'A', FHINCD: '\tPART\u3000', FSIGENCD: '1', FKOJUN: '1' };
    const pieces = [{ id: 'p1', isCompleted: intent === 'incomplete' }, { id: 'p2', isCompleted: intent === 'incomplete' }];
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData } as never);
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findUnique).mockResolvedValueOnce({ id: 'set', pieces } as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'row', rowData }]);
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({ isCompleted: intent === 'incomplete' } as never);
    vi.mocked(prisma.productionScheduleOrderAssignment.findUnique).mockResolvedValue(null);
    vi.mocked(readOverrides).mockResolvedValueOnce(new Map([['piece:p1', { overrideResourceCd: '021' }]]) as never);
    vi.mocked(syncWholePiecesOperationCompletions).mockResolvedValue(true);
    completionMocks.progress.mockResolvedValue({ parentIsCompleted: intent === 'complete' });
    try {
      await setProductionScheduleRowCompletionIntent({ rowId: 'row', locationKey: 'site', intent });
      expect(syncWholePiecesOperationCompletions).toHaveBeenCalledTimes(1);
      expect(syncWholePiecesOperationCompletions).toHaveBeenCalledWith(prisma, expect.any(String), [
        { id: 'p1', isCompleted: intent === 'incomplete', effectiveResourceCd: '021', fhincd: rowData.FHINCD },
        { id: 'p2', isCompleted: intent === 'incomplete', effectiveResourceCd: '1', fhincd: rowData.FHINCD }
      ], intent === 'complete');
    } finally { vi.mocked(prisma.$queryRaw).mockResolvedValue([]); }
  });
  it.each([false, true])('parent incomplete intent changes the version only when a piece was completed: %s', async (hasCompleted) => {
    const rowData = { FSEIBAN: 'A', FHINCD: 'PART', FSIGENCD: '1', FKOJUN: '1' };
    const pieces = [{ id: 'partial', isCompleted: false }, { id: 'other', isCompleted: hasCompleted }];
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData } as never);
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findUnique).mockResolvedValueOnce({ id: 'set', pieces } as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'row', rowData }]);
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({ isCompleted: false } as never);
    vi.mocked(syncWholePiecesOperationCompletions).mockResolvedValue(hasCompleted);
    completionMocks.progress.mockResolvedValue({ parentIsCompleted: false });
    try {
      const result = await setProductionScheduleRowCompletionIntent({ rowId: 'row', locationKey: 'site', intent: 'incomplete' });
      expect(result.unchanged).toBe(!hasCompleted);
      expect(syncWholePiecesOperationCompletions).toHaveBeenCalledWith(prisma, expect.any(String),
        pieces.map((piece) => ({ ...piece, effectiveResourceCd: '1', fhincd: 'PART' })), false);
      if (hasCompleted) {
        expect(prisma.productionScheduleSessakuPieceSet.update).toHaveBeenCalledExactlyOnceWith({
          where: { id: 'set' }, data: { version: { increment: 1 } }
        });
        expect(prisma.productionScheduleSessakuPiece.updateMany).toHaveBeenCalledTimes(1);
      } else {
        expect(prisma.productionScheduleSessakuPieceSet.update).not.toHaveBeenCalled();
        expect(prisma.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
      }
    } finally { vi.mocked(prisma.$queryRaw).mockResolvedValue([]); }
  });
  it.each(['complete', 'incomplete'] as const)('audits parent %s before/after pieces, operations and versions after commit', async (intent) => {
    const completed = intent === 'complete';
    const rowData = { FSEIBAN: 'A', FHINCD: 'PART', FSIGENCD: '1', FKOJUN: '1' };
    const before = { id: 'set', version: 3, plannedQuantity: 2, pieces: [
      { id: 'p1', quantity: 1, isCompleted: !completed }, { id: 'p2', quantity: 1, isCompleted: !completed }
    ] };
    const after = { ...before, version: 4, pieces: before.pieces.map((piece) => ({ ...piece, isCompleted: completed })) };
    const operations = before.pieces.map((piece) => ({ pieceId: piece.id, opNo: 1 }));
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row', rowData } as never);
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findUnique).mockResolvedValueOnce(before as never).mockResolvedValueOnce(after as never);
    vi.mocked(prisma.productionScheduleSessakuPieceOpCompletion.findMany)
      .mockResolvedValueOnce((completed ? [] : operations) as never).mockResolvedValueOnce((completed ? operations : []) as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'row', rowData }]);
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({ isCompleted: !completed } as never);
    vi.mocked(syncWholePiecesOperationCompletions).mockResolvedValue(true);
    completionMocks.progress.mockResolvedValue({ parentIsCompleted: completed });
    let committed = false;
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: (tx: typeof prisma) => Promise<unknown>) => {
      const result = await callback(prisma);
      expect(prisma.productionScheduleSessakuPieceAuditLog.create).not.toHaveBeenCalled();
      committed = true;
      return result;
    });
    vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mockImplementationOnce(async () => {
      expect(committed).toBe(true);
      // The audit failure must not undo or fail the original completion.
      throw new Error('audit unavailable');
    });
    try {
      await expect(setProductionScheduleRowCompletionIntent({ rowId: 'row', locationKey: 'site', intent })).resolves.toMatchObject({ success: true });
      expect(prisma.productionScheduleSessakuPieceAuditLog.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
        action: completed ? 'complete' : 'uncomplete', outcome: 'success', expectedVersion: 3, resultVersion: 4,
        fseiban: 'A', siteKey: 'site', parentItemId: expect.stringMatching(/^row:/), pieceIds: ['p1', 'p2'],
        beforeJson: expect.objectContaining({ count: 2, quantities: [1, 1], completedPieceIds: completed ? [] : ['p1', 'p2'], operations: completed ? [] : operations }),
        afterJson: expect.objectContaining({ count: 2, quantities: [1, 1], completedPieceIds: completed ? ['p1', 'p2'] : [], operations: completed ? operations : [] })
      }) });
    } finally { vi.mocked(prisma.$queryRaw).mockResolvedValue([]); }
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
