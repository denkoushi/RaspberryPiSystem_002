import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { listScheduleRowsByProductNo } from '../../production-schedule/production-schedule-lookup.service.js';
import { registerOrderPlacement } from '../mobile-placement-order-placement.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  clientDevice: { findUnique: vi.fn() }, csvDashboardRow: { findFirst: vi.fn() }, $transaction: vi.fn(),
} }));
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({ listScheduleRowsByProductNo: vi.fn() }));

const candidate = { rowId: 'first', productNo: '100', fseiban: 'S', fhincd: 'P', fhinmei: 'Name', fsigencd: 'MC', fkojun: 1 };
const input = { clientDeviceId: 'device', shelfCodeRaw: ' shelf ', manufacturingOrderBarcodeRaw: ' 100 ' };
const tx = {
  orderPlacementEvent: { create: vi.fn() },
  orderPlacementBranchState: { aggregate: vi.fn(), create: vi.fn() },
};

describe('order placement schedule snapshot compatibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'device' } as never);
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([candidate, { ...candidate, rowId: 'later' }]);
    tx.orderPlacementBranchState.aggregate.mockResolvedValue({ _max: { branchNo: 2 } });
    tx.orderPlacementEvent.create.mockResolvedValue({ id: 'event' });
    tx.orderPlacementBranchState.create.mockResolvedValue({ id: 'branch' });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as unknown as Prisma.TransactionClient));
  });

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
    } });
    expect(tx.orderPlacementBranchState.create).toHaveBeenCalledExactlyOnceWith({ data: {
      manufacturingOrderBarcodeRaw: '100', branchNo: 3, shelfCodeRaw: 'shelf', csvDashboardRowId: 'first',
      scheduleSnapshot: expectedSnapshot, lastEventId: 'event',
    } });
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
});
