import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { listScheduleRowsByProductNo } from '../../production-schedule/production-schedule-lookup.service.js';
import { findPurchaseOrderLookupRows } from '../../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { registerOrderPlacement } from '../mobile-placement-order-placement.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  orderPlacementEvent: { findUnique: vi.fn() }, orderPlacementBranchState: { findUnique: vi.fn(), findFirst: vi.fn() },
  clientDevice: { findUnique: vi.fn() }, csvDashboardRow: { findFirst: vi.fn() }, $transaction: vi.fn(),
} }));
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({ listScheduleRowsByProductNo: vi.fn() }));

vi.mock('../../purchase-order-lookup/purchase-order-lookup-query.service.js', () => ({ findPurchaseOrderLookupRows: vi.fn() }));

const candidate = { rowId: 'first', productNo: '100', fseiban: 'S', fhincd: 'P', fhinmei: 'Name', fsigencd: 'MC', fkojun: 1 };
const input = { clientDeviceId: 'device', shelfCodeRaw: ' shelf ', manufacturingOrderBarcodeRaw: ' 100 ' };
const tx = {
  $executeRaw: vi.fn(),
  orderPlacementEvent: { create: vi.fn(), aggregate: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  orderPlacementBranchState: { aggregate: vi.fn(), create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};

describe('order placement schedule snapshot compatibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.orderPlacementBranchState.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'first', rowData: {} } as never);
    tx.orderPlacementEvent.findUnique.mockResolvedValue(null);
    tx.orderPlacementBranchState.findMany.mockResolvedValue([]);
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'device' } as never);
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([candidate, { ...candidate, rowId: 'later' }]);
    tx.orderPlacementBranchState.aggregate.mockResolvedValue({ _max: { branchNo: 2 } });
    tx.orderPlacementEvent.aggregate.mockResolvedValue({ _max: { branchNo: null } });
    tx.orderPlacementEvent.create.mockResolvedValue({ id: 'event' });
    tx.orderPlacementBranchState.create.mockResolvedValue({ id: 'branch' });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as unknown as Prisma.TransactionClient));
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    [{ ProductNo: ' 100 ', FSEIBAN: ' S ', FHINCD: ' P ', FHINMEI: ' Name ' },
      { ProductNo: ' 100 ', FSEIBAN: ' S ', FHINCD: ' P ', FHINMEI: ' Name ' }],
    [{ ProductNo: 0, FSEIBAN: false, FHINCD: ['P'], FHINMEI: { name: 'Name' } },
      { ProductNo: 0, FSEIBAN: false, FHINCD: ['P'], FHINMEI: { name: 'Name' } }],
    [{ ProductNo: null, FSEIBAN: '', FHINCD: null },
      { ProductNo: null, FSEIBAN: '', FHINCD: null, FHINMEI: null }],
    [null, { ProductNo: null, FSEIBAN: null, FHINCD: null, FHINMEI: null }],
  ])('preserves stored JSON and the selected row (%j)', async (rowData, expectedSnapshot) => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'first', rowData } as never);
    await expect(registerOrderPlacement(input)).resolves.toEqual({
      action: 'created', event: { id: 'event' }, resolvedRowId: 'first', branchState: { id: 'branch' },
    });
    expect(listScheduleRowsByProductNo).toHaveBeenCalledExactlyOnceWith('100');
    expect(prisma.csvDashboardRow.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'first' }, select: { id: true, rowData: true },
    });
    expect(tx.orderPlacementEvent.create).toHaveBeenCalledExactlyOnceWith({ data: {
      clientDeviceId: 'device', shelfCodeRaw: 'shelf', manufacturingOrderBarcodeRaw: '100',
      csvDashboardRowId: 'first', scheduleSnapshot: expectedSnapshot, branchNo: 3, actionType: 'CREATE_BRANCH',
      clientRecordId: undefined, slipKind: 'manufacturing_order', placedAt: expect.any(Date),
    } });
    expect(tx.orderPlacementBranchState.create).toHaveBeenCalledExactlyOnceWith({ data: {
      manufacturingOrderBarcodeRaw: '100', branchNo: 3, shelfCodeRaw: 'shelf', csvDashboardRowId: 'first',
      scheduleSnapshot: expectedSnapshot, lastEventId: 'event', slipKind: 'manufacturing_order',
    } });
  });

  it.each([
    [null, null, 1], [2, 5, 6], [null, 5, 6], [7, 5, 8]
  ])('allocates after both current (%s) and historical (%s) branch numbers', async (current, historical, next) => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'first', rowData: {} } as never);
    tx.orderPlacementBranchState.aggregate.mockResolvedValue({ _max: { branchNo: current } });
    tx.orderPlacementEvent.aggregate.mockResolvedValue({ _max: { branchNo: historical } });
    await registerOrderPlacement(input);
    for (const model of [tx.orderPlacementBranchState, tx.orderPlacementEvent]) {
      expect(model.aggregate).toHaveBeenCalledExactlyOnceWith({
        where: { manufacturingOrderBarcodeRaw: '100' }, _max: { branchNo: true }
      });
      expect(model.create).toHaveBeenCalledWith({ data: expect.objectContaining({ branchNo: next }) });
    }
  });

  it('preserves the error when the selected row disappears, without writing', async () => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue(null);
    await expect(registerOrderPlacement(input)).rejects.toMatchObject({
      statusCode: 404, code: 'ORDER_PLACEMENT_SCHEDULE_NOT_FOUND', message: 'スケジュール行の取得に失敗しました',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not read or write when there are no candidates', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([]);
    await expect(registerOrderPlacement(input)).rejects.toMatchObject({
      statusCode: 404, code: 'ORDER_PLACEMENT_SCHEDULE_NOT_FOUND', message: '製造order番号に一致するスケジュール行がありません',
    });
    expect(prisma.csvDashboardRow.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('propagates snapshot read failures without writing', async () => {
    const failure = new Error('snapshot read unavailable');
    vi.mocked(prisma.csvDashboardRow.findFirst).mockRejectedValue(failure);
    await expect(registerOrderPlacement(input)).rejects.toBe(failure);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  const poInput = { ...input, manufacturingOrderBarcodeRaw: '4501238876', slipKind: 'purchase_order' as const };
  const poRow = { seiban: 'S', purchasePartCodeRaw: 'MAT1', purchasePartName: '材料' };

  it('registers a purchase order with one non-empty seiban using the existing snapshot keys', async () => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([poRow, { ...poRow, seiban: ' S ' }, { ...poRow, seiban: '' }] as never);
    await expect(registerOrderPlacement(poInput)).resolves.toMatchObject({ resolvedRowId: null });
    expect(findPurchaseOrderLookupRows).toHaveBeenCalledWith('4501238876');
    for (const model of [tx.orderPlacementEvent, tx.orderPlacementBranchState]) {
      expect(model.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        manufacturingOrderBarcodeRaw: '4501238876', csvDashboardRowId: null, slipKind: 'purchase_order', branchNo: 3,
        scheduleSnapshot: { FSEIBAN: 'S', FHINCD: 'MAT1', FHINMEI: '材料', PurchaseOrderNo: '4501238876' }
      }) });
    }
    expect(listScheduleRowsByProductNo).not.toHaveBeenCalled();
  });

  it.each([
    [[], 404, 'ORDER_PLACEMENT_PURCHASE_ORDER_NOT_FOUND', 'この注文番号は購買データにありません'],
    [[poRow, { ...poRow, seiban: 'OTHER' }], 409, 'ORDER_PLACEMENT_PURCHASE_ORDER_AMBIGUOUS', 'この注文番号は製番が複数あります']
  ])('rejects unusable purchase rows (%j)', async (rows, statusCode, code, message) => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue(rows as never);
    await expect(registerOrderPlacement(poInput)).rejects.toMatchObject({ statusCode, code, message });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['123456789', '12345678901', '123456789A'])('rejects non-10-digit PO %s', async (number) => {
    await expect(registerOrderPlacement({ ...poInput, manufacturingOrderBarcodeRaw: number })).rejects.toMatchObject({
      statusCode: 400, message: '注文番号は10桁の数字で読んでください'
    });
    expect(findPurchaseOrderLookupRows).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns the existing event and current branch on replay without lookup or creation', async () => {
    const event = { id: 'original', csvDashboardRowId: null, manufacturingOrderBarcodeRaw: '4501238876', branchNo: 2 };
    const branchState = { id: 'branch', shelfCodeRaw: 'moved shelf' };
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue(event as never);
    vi.mocked(prisma.orderPlacementBranchState.findUnique).mockResolvedValue(branchState as never);
    await expect(registerOrderPlacement({ ...poInput, clientRecordId: 'record' })).resolves.toEqual({ event, branchState, resolvedRowId: null, action: 'created' });
    expect(prisma.orderPlacementBranchState.findUnique).toHaveBeenCalledWith({ where: {
      manufacturingOrderBarcodeRaw_branchNo: { manufacturingOrderBarcodeRaw: '4501238876', branchNo: 2 }
    } });
    expect(findPurchaseOrderLookupRows).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('treats a replay whose branch was deleted as already registered', async () => {
    const event = { id: 'original', csvDashboardRowId: null, manufacturingOrderBarcodeRaw: '4501238876', branchNo: 2, shelfCodeRaw: 'A-1' };
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue(event as never);
    vi.mocked(prisma.orderPlacementBranchState.findUnique).mockResolvedValue(null);
    await expect(registerOrderPlacement({ ...poInput, clientRecordId: 'record' })).resolves.toEqual({
      action: 'created', event, branchState: { id: '', branchNo: 2, shelfCodeRaw: 'A-1' }, resolvedRowId: null
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('re-reads the winning record after a concurrent unique constraint failure', async () => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([poRow] as never);
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner', csvDashboardRowId: null } as never);
    vi.mocked(prisma.orderPlacementBranchState.findUnique).mockResolvedValue({ id: 'branch' } as never);
    vi.mocked(prisma.$transaction).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5' }));
    await expect(registerOrderPlacement({ ...poInput, clientRecordId: 'record' })).resolves.toMatchObject({ event: { id: 'winner' } });
    expect(prisma.orderPlacementEvent.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.orderPlacementEvent.create).not.toHaveBeenCalled();
  });

  it.each([-300001, -300000, 0, 3600000, 604800000, 604800001])('accepts or clamps client time (age %i ms)', async (age) => {
    vi.useFakeTimers();
    const now = new Date('2026-10-23T12:00:00Z');
    vi.setSystemTime(now);
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([poRow] as never);
    const placedAt = new Date(now.getTime() - age);
    await registerOrderPlacement({ ...poInput, placedAt: placedAt.toISOString() });
    expect(tx.orderPlacementEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      placedAt: age < -300000 || age > 604800000 ? now : placedAt
    }) });
  });

  it.each([0, 1, 5])('creates the requested stamp %i without automatic numbering', async (branchNo) => {
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'first', rowData: {} } as never);
    await expect(registerOrderPlacement({ ...input, branchNo })).resolves.toMatchObject({ action: 'created' });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.orderPlacementBranchState.findMany).toHaveBeenCalledWith({ where: { manufacturingOrderBarcodeRaw: '100' } });
    for (const model of [tx.orderPlacementEvent, tx.orderPlacementBranchState]) {
      expect(model.aggregate).not.toHaveBeenCalled();
      expect(model.create).toHaveBeenCalledWith({ data: expect.objectContaining({ branchNo }) });
    }
    expect(tx.orderPlacementEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'CREATE_BRANCH' }) });
  });

  const existing = { id: 'branch', branchNo: 2, shelfCodeRaw: 'old shelf', lastEventId: 'old-event',
    csvDashboardRowId: 'original-row', scheduleSnapshot: { FSEIBAN: 'original' }, slipKind: 'purchase_order' };
  it.each([0, 2])('moves existing stamp %i with its snapshot and replay identity', async (branchNo) => {
    const state = { ...existing, branchNo };
    vi.mocked(prisma.orderPlacementBranchState.findFirst).mockResolvedValue(state as never);
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([]);
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([]);
    tx.orderPlacementBranchState.findMany.mockResolvedValue([state]);
    tx.orderPlacementBranchState.update.mockResolvedValue({ ...state, shelfCodeRaw: 'shelf' });
    await expect(registerOrderPlacement({ ...poInput, branchNo, clientRecordId: 'record' })).resolves.toMatchObject({
      action: 'moved', resolvedRowId: 'original-row', branchState: { branchNo, shelfCodeRaw: 'shelf' }
    });
    expect(tx.orderPlacementEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      branchNo, actionType: 'MOVE_BRANCH', clientRecordId: 'record', slipKind: 'purchase_order',
      scheduleSnapshot: existing.scheduleSnapshot, csvDashboardRowId: 'original-row'
    }) });
    expect(tx.orderPlacementBranchState.update).toHaveBeenCalledWith({ where: { id: 'branch' }, data: { shelfCodeRaw: 'shelf', lastEventId: 'event' } });
    expect(findPurchaseOrderLookupRows).not.toHaveBeenCalled();
    expect(listScheduleRowsByProductNo).not.toHaveBeenCalled();
    expect(tx.orderPlacementBranchState.create).not.toHaveBeenCalled();
  });

  it('returns the current state without writing when the shelf is unchanged', async () => {
    vi.mocked(prisma.orderPlacementBranchState.findFirst).mockResolvedValue(existing as never);
    tx.orderPlacementBranchState.findMany.mockResolvedValue([{ ...existing, shelfCodeRaw: 'shelf' }]);
    tx.orderPlacementEvent.findUniqueOrThrow.mockResolvedValue({ id: 'old-event' });
    await expect(registerOrderPlacement({ ...input, branchNo: 2 })).resolves.toMatchObject({
      action: 'unchanged', event: { id: 'old-event' }, branchState: { shelfCodeRaw: 'shelf' }
    });
    expect(tx.orderPlacementEvent.create).not.toHaveBeenCalled();
    expect(tx.orderPlacementBranchState.update).not.toHaveBeenCalled();
    expect(tx.orderPlacementBranchState.create).not.toHaveBeenCalled();
    expect(listScheduleRowsByProductNo).not.toHaveBeenCalled();
  });

  it.each([[0, 1], [0, 6], [1, 0], [5, 0]])('rejects stamp %i with existing stamp %i', async (branchNo, current) => {
    tx.orderPlacementBranchState.findMany.mockResolvedValue([{ ...existing, branchNo: current }]);
    await expect(registerOrderPlacement({ ...input, branchNo })).rejects.toMatchObject({
      statusCode: 409, code: 'ORDER_PLACEMENT_BRANCH_CONFLICT', message: '分配なしと番号付きの分配は併用できません'
    });
    expect(tx.orderPlacementEvent.create).not.toHaveBeenCalled();
    expect(tx.orderPlacementBranchState.create).not.toHaveBeenCalled();
    expect(tx.orderPlacementBranchState.update).not.toHaveBeenCalled();
  });

  it('replays MOVE_BRANCH without moving a branch back after a later move', async () => {
    const event = { id: 'move', actionType: 'MOVE_BRANCH', branchNo: 2, manufacturingOrderBarcodeRaw: '100', csvDashboardRowId: 'original-row' };
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue(event as never);
    vi.mocked(prisma.orderPlacementBranchState.findUnique).mockResolvedValue({ ...existing, shelfCodeRaw: 'later shelf' } as never);
    await expect(registerOrderPlacement({ ...input, branchNo: 2, clientRecordId: 'record' })).resolves.toMatchObject({
      action: 'moved', event, branchState: { shelfCodeRaw: 'later shelf' }
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('checks replay again after acquiring the order lock', async () => {
    tx.orderPlacementEvent.findUnique.mockResolvedValue({ id: 'move', actionType: 'MOVE_BRANCH', branchNo: 2 });
    tx.orderPlacementBranchState.findUnique.mockResolvedValue(existing);
    await expect(registerOrderPlacement({ ...input, branchNo: 2, clientRecordId: 'record' })).resolves.toMatchObject({ action: 'moved' });
    expect(tx.orderPlacementBranchState.findMany).not.toHaveBeenCalled();
    expect(tx.orderPlacementEvent.create).not.toHaveBeenCalled();
  });

  it.each(['manufacturing_order', 'purchase_order'] as const)('resolves a new %s stamp before starting the transaction', async (slipKind) => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([poRow] as never);
    await registerOrderPlacement({ ...(slipKind === 'purchase_order' ? poInput : input), slipKind, branchNo: 3 });
    expect(prisma.orderPlacementBranchState.findFirst).toHaveBeenCalledWith({ where: {
      manufacturingOrderBarcodeRaw: slipKind === 'purchase_order' ? '4501238876' : '100', branchNo: 3
    } });
    const lookup = slipKind === 'purchase_order' ? findPurchaseOrderLookupRows : listScheduleRowsByProductNo;
    const calls = [
      vi.mocked(prisma.orderPlacementBranchState.findFirst).mock.invocationCallOrder[0],
      vi.mocked(lookup).mock.invocationCallOrder[0],
      ...(slipKind === 'manufacturing_order' ? [vi.mocked(prisma.csvDashboardRow.findFirst).mock.invocationCallOrder[0]] : []),
      vi.mocked(prisma.$transaction).mock.invocationCallOrder[0],
      tx.$executeRaw.mock.invocationCallOrder[0],
      tx.orderPlacementEvent.create.mock.invocationCallOrder[0]
    ];
    expect(calls.every((call) => typeof call === 'number')).toBe(true);
    expect(calls).toEqual([...calls].sort((a, b) => a - b));
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('resolves inside the lock only when a previously existing stamp disappeared', async () => {
    vi.mocked(prisma.orderPlacementBranchState.findFirst).mockResolvedValue(existing as never);
    await expect(registerOrderPlacement({ ...input, branchNo: 2 })).resolves.toMatchObject({ action: 'created' });
    expect(vi.mocked(listScheduleRowsByProductNo).mock.invocationCallOrder[0]).toBeGreaterThan(tx.$executeRaw.mock.invocationCallOrder[0]);
  });

  it('records an unchanged request and replays it without undoing a later move', async () => {
    let current = { ...existing, shelfCodeRaw: 'shelf' };
    const events = new Map<string, { id: string; clientRecordId?: string }>();
    vi.mocked(prisma.orderPlacementBranchState.findFirst).mockImplementation(async () => current as never);
    vi.mocked(prisma.orderPlacementBranchState.findUnique).mockImplementation(async () => current as never);
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockImplementation(async (args) => (events.get(args.where.clientRecordId!) ?? null) as never);
    tx.orderPlacementBranchState.findMany.mockImplementation(async () => [current]);
    tx.orderPlacementEvent.create.mockImplementation(async ({ data }) => {
      const event = { ...data, id: `event-${events.size}` };
      events.set(data.clientRecordId, event);
      return event;
    });
    tx.orderPlacementBranchState.update.mockImplementation(async ({ data }) => { current = { ...current, ...data }; return current; });
    const unchanged = { ...input, branchNo: 2, clientRecordId: 'unchanged-record' };
    await expect(registerOrderPlacement(unchanged)).resolves.toMatchObject({ action: 'unchanged' });
    expect(tx.orderPlacementEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      clientRecordId: 'unchanged-record', actionType: 'MOVE_BRANCH', branchNo: 2, shelfCodeRaw: 'shelf'
    }) });
    expect(current.lastEventId).toBe('event-0');
    await registerOrderPlacement({ ...input, branchNo: 2, shelfCodeRaw: 'later shelf', clientRecordId: 'move-record' });
    await expect(registerOrderPlacement(unchanged)).resolves.toMatchObject({
      action: 'moved', event: { id: 'event-0' }, branchState: { shelfCodeRaw: 'later shelf', lastEventId: 'event-1' }
    });
    expect(tx.orderPlacementEvent.create).toHaveBeenCalledTimes(2);
    expect(tx.orderPlacementBranchState.update).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(listScheduleRowsByProductNo).not.toHaveBeenCalled();
  });

  it('rejects automatic numbering when no-distribution already exists', async () => {
    tx.orderPlacementBranchState.findMany.mockResolvedValue([{ ...existing, branchNo: 0 }]);
    await expect(registerOrderPlacement(input)).rejects.toMatchObject({ statusCode: 409, code: 'ORDER_PLACEMENT_BRANCH_CONFLICT' });
    expect(tx.orderPlacementEvent.create).not.toHaveBeenCalled();
    expect(tx.orderPlacementBranchState.create).not.toHaveBeenCalled();
  });

  it('creates another numbered stamp alongside an existing numbered stamp', async () => {
    tx.orderPlacementBranchState.findMany.mockResolvedValue([existing]);
    await expect(registerOrderPlacement({ ...input, branchNo: 3 })).resolves.toMatchObject({ action: 'created' });
    expect(tx.orderPlacementBranchState.create).toHaveBeenCalledWith({ data: expect.objectContaining({ branchNo: 3 }) });
    expect(tx.orderPlacementBranchState.update).not.toHaveBeenCalled();
  });

});
