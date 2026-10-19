import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { prisma } from '../../../lib/prisma.js';
import { listScheduleRowsByProductNo, resolveMachineNameForSeiban } from '../../production-schedule/production-schedule-lookup.service.js';
import { resolveScheduleSnapshotForPalletItem } from '../pallet-visualization-schedule-resolver.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { csvDashboardRow: { findFirst: vi.fn() } } }));
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({
  listScheduleRowsByProductNo: vi.fn(), resolveMachineNameForSeiban: vi.fn(),
}));

const candidate = {
  rowId: 'row-first', fseiban: 'SEIBAN-1', productNo: '100', fhincd: 'PART-A',
  fhinmei: 'Part A', fsigencd: 'MC01', fkojun: 10,
};

describe('pallet schedule resolution compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveMachineNameForSeiban).mockResolvedValue('Model A');
  });

  it('selects the first resource match and preserves raw snapshot fields', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([
      { ...candidate, rowId: 'other-resource', fsigencd: 'MC02' },
      candidate,
      { ...candidate, rowId: 'later-match', fkojun: 20 },
    ]);
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-first',
      rowData: { ProductNo: '100', FSEIBAN: ' SEIBAN-1 ', FHINCD: ' PART-A ', FHINMEI: ' Stored name ', FSIGENCD: 'MC01', FGAISUN: ' 10  x  20 ' },
      orderSupplements: [{ plannedQuantity: 5, plannedStartDate: new Date('2026-09-01T00:00:00Z') }],
    } as never);
    await expect(resolveScheduleSnapshotForPalletItem(' mc01 ', ' 100 ')).resolves.toEqual({
      csvDashboardRowId: 'row-first', fhincd: 'PART-A', fhinmei: 'Stored name', fseiban: 'SEIBAN-1', machineName: 'Model A',
      scheduleSnapshot: {
        ProductNo: '100', FSEIBAN: ' SEIBAN-1 ', FHINCD: ' PART-A ', FHINMEI: ' Stored name ', FSIGENCD: 'MC01',
        plannedQuantity: 5, plannedStartDateDisplay: '2026-09-01', outsideDimensionsDisplay: '10 x 20',
      },
    });
    expect(listScheduleRowsByProductNo).toHaveBeenCalledExactlyOnceWith('100');
    expect(prisma.csvDashboardRow.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.csvDashboardRow.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'row-first' } }));
    expect(resolveMachineNameForSeiban).toHaveBeenCalledExactlyOnceWith('SEIBAN-1');
  });

  it('preserves the resource mismatch error without reading a snapshot', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([{ ...candidate, fsigencd: 'MC02' }]);
    await expect(resolveScheduleSnapshotForPalletItem('MC01', '100')).rejects.toMatchObject({
      statusCode: 404, code: 'PALLET_SCHEDULE_NOT_FOUND_FOR_MACHINE',
    });
    expect(prisma.csvDashboardRow.findFirst).not.toHaveBeenCalled();
    expect(resolveMachineNameForSeiban).not.toHaveBeenCalled();
  });

  it('preserves the error when the selected row disappears before snapshot lookup', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([candidate]);
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue(null);
    await expect(resolveScheduleSnapshotForPalletItem('MC01', '100')).rejects.toMatchObject({
      statusCode: 404, code: 'PALLET_SCHEDULE_ROW_MISSING',
    });
    expect(resolveMachineNameForSeiban).not.toHaveBeenCalled();
  });
  it('preserves the exact read projection and null snapshot fields while falling back to candidate labels', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([candidate]);
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row-first', rowData: {}, orderSupplements: [] } as never);
    await expect(resolveScheduleSnapshotForPalletItem('MC01', '100')).resolves.toEqual({
      csvDashboardRowId: 'row-first', fhincd: 'PART-A', fhinmei: 'Part A', fseiban: 'SEIBAN-1', machineName: 'Model A',
      scheduleSnapshot: { ProductNo: null, FSEIBAN: null, FHINCD: null, FHINMEI: null, FSIGENCD: null,
        plannedQuantity: null, plannedStartDateDisplay: null, outsideDimensionsDisplay: null },
    });
    expect(prisma.csvDashboardRow.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'row-first' }, select: { id: true, rowData: true, orderSupplements: {
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
        take: 1, select: { plannedQuantity: true, plannedStartDate: true },
      } },
    });
  });

  it('preserves false, zero, empty strings and JSON while keeping dimension alias priority', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([candidate]);
    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({ id: 'row-first',
      rowData: { ProductNo: 0, FSEIBAN: false, FHINCD: '', FHINMEI: ['A', 'B'], FSIGENCD: { code: 'MC01' }, FGAISUN: ' ', FSUNPO: 0, FGAISUNPO: 'later' },
      orderSupplements: [{ plannedQuantity: 0, plannedStartDate: null }],
    } as never);
    await expect(resolveScheduleSnapshotForPalletItem('MC01', '100')).resolves.toEqual({
      csvDashboardRowId: 'row-first', fhincd: '', fhinmei: 'A,B', fseiban: 'false', machineName: 'Model A',
      scheduleSnapshot: { ProductNo: 0, FSEIBAN: false, FHINCD: '', FHINMEI: ['A', 'B'], FSIGENCD: { code: 'MC01' },
        plannedQuantity: 0, plannedStartDateDisplay: null, outsideDimensionsDisplay: '0' },
    });
    expect(resolveMachineNameForSeiban).toHaveBeenCalledExactlyOnceWith('SEIBAN-1');
  });

  it('propagates snapshot read failures without querying machine names', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([candidate]);
    const failure = new Error('snapshot read unavailable');
    vi.mocked(prisma.csvDashboardRow.findFirst).mockRejectedValue(failure);
    await expect(resolveScheduleSnapshotForPalletItem('MC01', '100')).rejects.toBe(failure);
    expect(resolveMachineNameForSeiban).not.toHaveBeenCalled();
  });

});
