import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../../production-schedule/seiban-machine-display-names.service.js';
import { listMobileVerifyRecords } from '../mobile-verify-record.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  mobileSlipVerifyRecord: { findMany: vi.fn() }, csvDashboardRow: { findMany: vi.fn() }, orderPlacementEvent: { findMany: vi.fn() }
} }));
vi.mock('../../production-schedule/seiban-machine-display-names.service.js', () => ({ resolveSeibanMachineDisplayNamesBatched: vi.fn() }));
const row = { id: 'verify', verifiedAt: new Date('2026-10-29T03:00:00Z'), clientDeviceId: 'phone', clientDevice: { name: 'スマホ' },
  transferOrderBarcodeRaw: '0002178005', transferPartRaw: '', actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS2', actualPartRaw: 'RAW',
  outcome: 'mismatch', reason: 'different_seiban', expectedFseiban: null, expectedFhincd: null, expectedPartName: null,
  actualResolvedFseiban: 'FS3', actualPartCode: 'RESOLVED', clientRecordId: 'placement' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([row] as never);
  vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([{ rowData: { ProductNo: '0002178005', FSEIBAN: 'FS1', FHINCD: 'P1', FHINMEI: '部品' } }] as never);
  vi.mocked(prisma.orderPlacementEvent.findMany).mockResolvedValue([{ clientRecordId: 'placement', clientDeviceId: 'phone', shelfCodeRaw: '棚', branchNo: 2 }] as never);
  vi.mocked(resolveSeibanMachineDisplayNamesBatched).mockResolvedValue({ machineNames: { FS1: '機械' } });
});
describe('listMobileVerifyRecords', () => {
  it.each(['1', '7', '30'] as const)('limits %s days to 500 newest records and batches schedule/placement lookups', async (days) => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T04:00:00Z'));
    const records = await listMobileVerifyRecords({ days });
    expect(prisma.mobileSlipVerifyRecord.findMany).toHaveBeenCalledWith({
      where: { verifiedAt: { gte: new Date(Date.now() - Number(days) * 86400000) } },
      include: { clientDevice: { select: { name: true } } }, orderBy: [{ verifiedAt: 'desc' }, { id: 'asc' }], take: 500
    });
    expect(prisma.csvDashboardRow.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: [{ rowData: { path: ['ProductNo'], equals: '0002178005' } }]
    } }));
    expect(prisma.orderPlacementEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientRecordId: { in: ['placement'] } } }));
    expect(records).toEqual([{ id: 'verify', verifiedAt: '2026-10-29T03:00:00.000Z', deviceName: 'スマホ', result: 'mismatch', reason: 'different_seiban',
      transfer: { orderNo: '0002178005', partNo: 'P1', fseiban: 'FS1' }, actual: { slipNo: null, partNo: 'RAW', fseiban: 'FS3' },
      mismatch: 'fseiban', fhinmei: '部品', machineName: '機械', placedShelfCodeRaw: '棚', branchNo: 2 }]);
    now.mockRestore();
  });
  it('prefers the verify snapshot and ignores another device placement', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([{ ...row, expectedPartName: '当時の部品', expectedFseiban: 'FS0', expectedFhincd: 'P0', actualResolvedFseiban: null, actualPartRaw: '' }] as never);
    vi.mocked(prisma.orderPlacementEvent.findMany).mockResolvedValue([{ clientRecordId: 'placement', clientDeviceId: 'other', shelfCodeRaw: '別の棚', branchNo: 1 }] as never);
    expect((await listMobileVerifyRecords({ days: '7' }))[0]).toMatchObject({
      transfer: { fseiban: 'FS0', partNo: 'P0' }, actual: { fseiban: 'FS2', partNo: 'RESOLVED' },
      fhinmei: '当時の部品', machineName: null, placedShelfCodeRaw: null, branchNo: null
    });
  });
  it('returns null fields when schedule and placement data are absent', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([]);
    vi.mocked(prisma.orderPlacementEvent.findMany).mockResolvedValue([]);
    expect((await listMobileVerifyRecords({ days: '7' }))[0]).toMatchObject({ transfer: { partNo: null, fseiban: null }, fhinmei: null, machineName: null, placedShelfCodeRaw: null, branchNo: null });
  });
  it('returns an empty list without enrichment queries', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([]);
    expect(await listMobileVerifyRecords({ days: '7' })).toEqual([]);
    expect(prisma.csvDashboardRow.findMany).not.toHaveBeenCalled();
  });
});
