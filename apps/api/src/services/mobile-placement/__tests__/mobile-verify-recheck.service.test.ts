import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { mapVerifyOutcome, recheckUnresolvedSlipVerifyRecords } from '../mobile-verify-recheck.service.js';
import { verifySlipMatch } from '../mobile-placement-verify-slip.service.js';

vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { mobileSlipVerifyRecord: { findMany: vi.fn(), update: vi.fn() } } }));
vi.mock('../mobile-placement-verify-slip.service.js', () => ({ verifySlipMatch: vi.fn() }));

const now = new Date('2026-11-20T00:00:00Z');
const row = (id: string, extra = {}) => ({ id, transferOrderBarcodeRaw: `T${id}`, transferPartRaw: null, actualOrderBarcodeRaw: `A${id}`,
  actualFseibanRaw: '', actualPartRaw: 'P', ...extra });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.mobileSlipVerifyRecord.update).mockResolvedValue({} as never);
});

describe('mapVerifyOutcome', () => {
  it.each([
    [{ ok: true, reason: 'match' }, 'match'], [{ ok: false, reason: 'different_seiban' }, 'mismatch'],
    [{ ok: false, reason: 'different_part' }, 'mismatch'], [{ ok: false, reason: 'part_required' }, 'not_found'],
    [{ ok: false, reason: 'order_not_found' }, 'not_found'], [{ ok: false, reason: 'transfer_not_found' }, 'not_found']
  ] as const)('%j -> %s', (result, expected) => { expect(mapVerifyOutcome(result)).toBe(expected); });
});

describe('recheckUnresolvedSlipVerifyRecords', () => {
  it('selects only unrechecked not_found records of the last 30 days with resolvable reasons', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([]);
    expect(await recheckUnresolvedSlipVerifyRecords({ now, limit: 10 })).toEqual({ checked: 0, matched: 0, mismatched: 0 });
    expect(prisma.mobileSlipVerifyRecord.findMany).toHaveBeenCalledWith({
      where: { outcome: 'not_found', reason: { in: ['transfer_not_found', 'order_not_found'] },
        verifiedAt: { gte: new Date('2026-10-21T00:00:00Z') }, recheckOutcome: null },
      orderBy: { verifiedAt: 'desc' }, take: 10
    });
  });
  it('appends match and mismatch results, using stored raw inputs', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([row('1'), row('2')] as never);
    vi.mocked(verifySlipMatch)
      .mockResolvedValueOnce({ ok: true, reason: 'match' } as never)
      .mockResolvedValueOnce({ ok: false, reason: 'different_part' } as never);
    expect(await recheckUnresolvedSlipVerifyRecords({ now })).toEqual({ checked: 2, matched: 1, mismatched: 1 });
    expect(verifySlipMatch).toHaveBeenNthCalledWith(1, { transferOrderBarcodeRaw: 'T1', transferPartBarcodeRaw: '',
      actualOrderBarcodeRaw: 'A1', actualFseibanRaw: '', actualPartBarcodeRaw: 'P' });
    expect(prisma.mobileSlipVerifyRecord.update).toHaveBeenNthCalledWith(1, { where: { id: '1' },
      data: { recheckOutcome: 'match', recheckReason: 'match', recheckedAt: now } });
    expect(prisma.mobileSlipVerifyRecord.update).toHaveBeenNthCalledWith(2, { where: { id: '2' },
      data: { recheckOutcome: 'mismatch', recheckReason: 'different_part', recheckedAt: now } });
  });
  it('writes nothing while the result is still not_found', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([row('1'), row('2')] as never);
    vi.mocked(verifySlipMatch).mockResolvedValue({ ok: false, reason: 'transfer_not_found' } as never);
    expect(await recheckUnresolvedSlipVerifyRecords({ now })).toEqual({ checked: 2, matched: 0, mismatched: 0 });
    expect(prisma.mobileSlipVerifyRecord.update).not.toHaveBeenCalled();
  });
  it('continues after one record fails', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([row('1'), row('2')] as never);
    vi.mocked(verifySlipMatch).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ ok: true, reason: 'match' } as never);
    expect(await recheckUnresolvedSlipVerifyRecords({ now })).toEqual({ checked: 1, matched: 1, mismatched: 0 });
    expect(prisma.mobileSlipVerifyRecord.update).toHaveBeenCalledTimes(1);
  });
});
