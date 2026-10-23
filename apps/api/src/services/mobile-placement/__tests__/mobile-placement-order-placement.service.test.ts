import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { listScheduleRowsByProductNo } from '../../production-schedule/production-schedule-lookup.service.js';
import { findPurchaseOrderLookupRows } from '../../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { registerOrderPlacement } from '../mobile-placement-order-placement.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  orderPlacementEvent: { findUnique: vi.fn() }, orderPlacementBranchState: { findUnique: vi.fn() },
  clientDevice: { findUnique: vi.fn() }, csvDashboardRow: { findFirst: vi.fn() }, $transaction: vi.fn(),
} }));
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({ listScheduleRowsByProductNo: vi.fn() }));

vi.mock('../../purchase-order-lookup/purchase-order-lookup-query.service.js', () => ({ findPurchaseOrderLookupRows: vi.fn() }));

const candidate = { rowId: 'first', productNo: '100', fseiban: 'S', fhincd: 'P', fhinmei: 'Name', fsigencd: 'MC', fkojun: 1 };
const input = { clientDeviceId: 'device', shelfCodeRaw: ' shelf ', manufacturingOrderBarcodeRaw: ' 100 ' };
const tx = {
  orderPlacementEvent: { create: vi.fn(), aggregate: vi.fn() },
  orderPlacementBranchState: { aggregate: vi.fn(), create: vi.fn() },
};

describe('order placement schedule snapshot compatibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue(null);
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
      event: { id: 'event' }, resolvedRowId: 'first', branchState: { id: 'branch' },
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
    await expect(registerOrderPlacement({ ...poInput, clientRecordId: 'record' })).resolves.toEqual({ event, branchState, resolvedRowId: null });
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
      event, branchState: { id: '', branchNo: 2, shelfCodeRaw: 'A-1' }, resolvedRowId: null
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

});
