import { describe, expect, it, vi } from 'vitest';

import { snapNativeSlip } from './native-slip.js';
import { packPurchase, packSchedule, unpackPurchase, unpackSchedule } from './snapshot.js';
import { verifySlipMatch } from './verify.js';

const schedule = { rowId: 'r', fseiban: 'FS1', productNo: 'T1', fhincd: 'MD1(A)-001', fhinmei: 'ブラケット', fsigencd: 'M', fkojun: 1 };
const purchase = { purchaseOrderNo: '1234567890', seiban: 'FS1', purchasePartName: 'ブラケット', purchasePartCodeRaw: 'MD1(B)-002',
  purchasePartCodeNormalized: 'MD1-002', purchasePartCodeMatchKey: 'MD1', masterPartName: '部品', machineName: '機種', acceptedQuantity: 2, plannedStartDate: '2026-10-27' };
const input = { transferOrderBarcodeRaw: ' T1 ', actualOrderBarcodeRaw: '1234567890', actualFseibanRaw: '' };
function source() {
  return { listScheduleRowsByProductNo: vi.fn((no: string) => Promise.resolve(no === 'T1' ? [schedule] : [])),
    listScheduleRowsByFseiban: vi.fn(() => Promise.resolve([schedule])),
    findPurchaseOrderLookupRows: vi.fn(() => Promise.resolve([purchase])) };
}
describe('shared slip verification', () => {
  it('round-trips every wire column including normalized codes and joined fields', () => {
    expect(unpackPurchase(packPurchase(purchase))).toEqual(purchase);
    expect(unpackSchedule(packSchedule(schedule))).toEqual(schedule);
  });
  it('matches purchase codes with suffixes, using trimmed lookup keys', async () => {
    const data = source();
    expect(await verifySlipMatch(input, data)).toMatchObject({ ok: true, reason: 'match', actualResolvedBy: 'purchaseOrder' });
    expect(data.listScheduleRowsByProductNo).toHaveBeenCalledWith('T1');
  });
  it('retains part-name fallback and rejection of explicitly scanned wrong parts', async () => {
    const data = source(); data.findPurchaseOrderLookupRows.mockResolvedValue([{ ...purchase, purchasePartCodeMatchKey: 'OTHER' }]);
    expect(await verifySlipMatch(input, data)).toMatchObject({ ok: true, matchedBy: 'part_name' });
    expect(await verifySlipMatch({ ...input, actualPartBarcodeRaw: 'WRONG' }, data)).toMatchObject({ ok: false, legacyReason: 'ACTUAL_PART_MISMATCH' });
  });
  it('requires part number for a printed 製番 and preserves ProductNo priority', async () => {
    expect(await verifySlipMatch({ ...input, actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS1' }, source())).toMatchObject({ reason: 'part_required' });
    const data = source(); data.listScheduleRowsByProductNo.mockResolvedValue([schedule]);
    expect(await verifySlipMatch(input, data)).toMatchObject({ actualResolvedBy: 'productNo' });
    expect(data.findPurchaseOrderLookupRows).not.toHaveBeenCalled();
  });
  it('uses known 製番 without biasing toward the expected slip', () => {
    expect(snapNativeSlip(['BE1N9327'], '製造order 1234567890', ['BE1N9321', 'BE1N9327'])).toMatchObject({
      engine: 'device', manufacturingOrder10: '1234567890', fseiban: 'BE1N9327', fseibanMatch: 'exact'
    });
  });
  it.each(['0004099556', ' 4501238876\t', '\u30000004099556\u3000'])('ignores order-shaped part scans when the order resolves: %j', async (part) => {
    expect(await verifySlipMatch({ ...input, transferPartBarcodeRaw: part, actualPartBarcodeRaw: part }, source()))
      .toMatchObject({ ok: true, reason: 'match', actualResolvedBy: 'purchaseOrder' });
  });
  it.each(['', '   ', '0004099556', ' 4501238876\t', '\u30000004099556\u3000'])('requires a real part number for the printed 製番 fallback: %j', async (part) => {
    expect(await verifySlipMatch({ ...input, actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS1', actualPartBarcodeRaw: part }, source()))
      .toMatchObject({ ok: false, reason: 'part_required', actualResolvedBy: 'fseiban', actual: { fseiban: 'FS1' } });
  });
  it.each([
    [schedule.fhincd, true, 'match'],
    ['WRONG', false, 'different_part']
  ] as const)('checks a real part number in the printed 製番 fallback: %s', async (part, ok, reason) => {
    expect(await verifySlipMatch({ ...input, actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS1', actualPartBarcodeRaw: part }, source()))
      .toMatchObject({ ok, reason, actualResolvedBy: 'fseiban' });
  });
});
