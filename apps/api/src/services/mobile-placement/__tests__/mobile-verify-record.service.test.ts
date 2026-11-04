import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../../production-schedule/seiban-machine-display-names.service.js';
import { listMobileVerifyRecords } from '../mobile-verify-record.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  mobileSlipVerifyRecord: { findMany: vi.fn() }, $queryRaw: vi.fn(), orderPlacementEvent: { findMany: vi.fn() }
} }));
vi.mock('../../production-schedule/seiban-machine-display-names.service.js', () => ({ resolveSeibanMachineDisplayNamesBatched: vi.fn() }));
const row = { id: 'verify', verifiedAt: new Date('2026-10-29T03:00:00Z'), clientDeviceId: 'phone', clientDevice: { name: 'スマホ' },
  transferOrderBarcodeRaw: '0002178005', transferPartRaw: '', actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS2', actualPartRaw: 'RAW',
  outcome: 'mismatch', reason: 'different_seiban', expectedFseiban: null, expectedFhincd: null, expectedPartName: null,
  actualResolvedFseiban: 'FS3', actualPartCode: 'RESOLVED', clientRecordId: 'placement' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([row] as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ rowData: { ProductNo: '0002178005', FSEIBAN: 'FS1', FHINCD: 'P1', FHINMEI: '部品' } }] as never);
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
    const [strings, ...values] = vi.mocked(prisma.$queryRaw).mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const query = Prisma.sql(strings, ...values);
    expect(query.text).toContain(`"rowData"->>'ProductNo' = ANY($2::text[])`);
    expect(query.text).toContain(`jsonb_typeof("rowData"->'ProductNo') = 'string'`);
    expect(query.text).toMatch(/ORDER BY "id" ASC$/);
    expect(query.values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID, ['0002178005']]);
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
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.orderPlacementEvent.findMany).mockResolvedValue([]);
    expect((await listMobileVerifyRecords({ days: '7' }))[0]).toMatchObject({ transfer: { partNo: null, fseiban: null }, fhinmei: null, machineName: null, placedShelfCodeRaw: null, branchNo: null });
  });
  it('dedupes padded orders and keeps the first schedule row per order', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([row, { ...row, id: 'padded', transferOrderBarcodeRaw: ' 0002178005 ' }] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { rowData: { ProductNo: '0002178005', FSEIBAN: 'FS1', FHINCD: 'P1', FHINMEI: '部品' } },
      { rowData: { ProductNo: '0002178005', FSEIBAN: 'FS9', FHINCD: 'P9', FHINMEI: '後の行' } }
    ] as never);
    const records = await listMobileVerifyRecords({ days: '7' });
    expect(vi.mocked(prisma.$queryRaw).mock.calls[0]?.slice(1)).toEqual([expect.objectContaining({ values: [PRODUCTION_SCHEDULE_DASHBOARD_ID, ['0002178005']] })]);
    expect(records.map(record => [record.transfer.fseiban, record.fhinmei])).toEqual([['FS1', '部品'], ['FS1', '部品']]);
  });
  it('returns an empty list without enrichment queries', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([]);
    expect(await listMobileVerifyRecords({ days: '7' })).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
