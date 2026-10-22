import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifySlipMatch } from '../mobile-placement-verify-slip.service.js';
import { resolveScheduleRowByProductNo, resolveScheduleRowByFseiban } from '../mobile-placement-order-lookup.js';
import { findPurchaseOrderLookupRows } from '../../purchase-order-lookup/purchase-order-lookup-query.service.js';

vi.mock('../mobile-placement-order-lookup.js', () => ({
  resolveScheduleRowByProductNo: vi.fn(), resolveScheduleRowByFseiban: vi.fn()
}));
vi.mock('../../purchase-order-lookup/purchase-order-lookup-query.service.js', () => ({ findPurchaseOrderLookupRows: vi.fn() }));

const transfer = { rowId: 'r', fseiban: ' FS1 ', productNo: 'T1', fhincd: 'MD123(A)-001', fhinmei: 'ブラケット', fsigencd: '', fkojun: 1 };
const input = {
  transferOrderBarcodeRaw: 'T1', transferPartBarcodeRaw: transfer.fhincd,
  actualOrderBarcodeRaw: ' 1234567890 ', actualFseibanRaw: '', actualPartBarcodeRaw: transfer.fhincd
};
const expected = { fseiban: 'FS1', fhincd: transfer.fhincd, partName: 'ブラケット' };
const purchase = (seiban = 'fs1', key = 'MD123') => ({
  id: 'po', sourceCsvDashboardId: 'purchase', purchaseOrderNo: '1234567890', seiban,
  purchasePartCodeRaw: 'MD123(B)-002', purchasePartCodeNormalized: 'MD123-002', purchasePartCodeMatchKey: key,
  purchasePartName: '', acceptedQuantity: 0, purchaseStatus: null, sourceUpdatedAt: null,
  lineIndex: 0, createdAt: new Date(), updatedAt: new Date()
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveScheduleRowByProductNo).mockImplementation(async (order) => order === 'T1' ? transfer : null);
  vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([]);
});

describe('verifySlipMatch purchase order resolution', () => {
  it('matches a material code on the 現品票 by 製番 and part name', async () => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([{ ...purchase('fs1', 'MD999'), purchasePartCodeRaw: 'MD999', purchasePartName: 'ブラケット ' }]);
    expect(await verifySlipMatch({ ...input, transferPartBarcodeRaw: '', actualPartBarcodeRaw: '' })).toEqual({
      ok: true, reason: 'match', actualResolvedBy: 'purchaseOrder', expected, matchedBy: 'part_name',
      actual: { fseiban: 'fs1', partCode: 'MD999' }
    });
  });
  it('keeps different_part when neither the code nor the part name matches', async () => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([{ ...purchase('fs1', 'MD999'), purchasePartName: 'ナットホルダー' }]);
    expect(await verifySlipMatch({ ...input, transferPartBarcodeRaw: '', actualPartBarcodeRaw: '' })).toMatchObject({ ok: false, reason: 'different_part' });
  });
  it.each([undefined, ''])('matches two barcodes without scanned parts (%s)', async (parts) => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase('other'), purchase()]);
    expect(await verifySlipMatch({ ...input, transferPartBarcodeRaw: parts, actualPartBarcodeRaw: parts })).toEqual({
      ok: true, reason: 'match', actualResolvedBy: 'purchaseOrder', expected,
      actual: { fseiban: 'fs1', partCode: 'MD123(B)-002' }
    });
    expect(findPurchaseOrderLookupRows).toHaveBeenCalledWith('1234567890');
  });
  it.each([
    { rows: [purchase('other')], reason: 'different_seiban', seiban: 'other' },
    { rows: [purchase('fs1', 'OTHER')], reason: 'different_part', seiban: 'fs1' },
    { rows: [purchase('other'), purchase('fs1', 'OTHER')], reason: 'different_part', seiban: 'fs1' }
  ])('reports $reason and actual PO metadata', async ({ rows, reason, seiban }) => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue(rows);
    expect(await verifySlipMatch(input)).toEqual({ ok: false, reason, legacyReason: 'FSEIBAN_OR_PART_PAIR_MISMATCH', actualResolvedBy: 'purchaseOrder', expected,
      actual: { fseiban: seiban, partCode: 'MD123(B)-002' } });
  });
  it('gives ProductNo precedence', async () => {
    vi.mocked(resolveScheduleRowByProductNo).mockResolvedValue(transfer);
    expect(await verifySlipMatch(input)).toMatchObject({ ok: true, reason: 'match', actualResolvedBy: 'productNo', expected });
    expect(findPurchaseOrderLookupRows).not.toHaveBeenCalled();
  });
  it('does not override a ProductNo pair mismatch', async () => {
    vi.mocked(resolveScheduleRowByProductNo).mockResolvedValueOnce(transfer).mockResolvedValueOnce({ ...transfer, fseiban: 'OTHER' });
    expect(await verifySlipMatch(input)).toMatchObject({ ok: false, reason: 'different_seiban', actualResolvedBy: 'productNo', actual: { fseiban: 'OTHER' } });
    expect(findPurchaseOrderLookupRows).not.toHaveBeenCalled();
  });
  it('returns order_not_found only when neither lookup resolves', async () => {
    expect(await verifySlipMatch(input)).toEqual({ ok: false, reason: 'order_not_found', legacyReason: 'ACTUAL_ORDER_UNRESOLVED', expected });
  });
  it('prioritizes an unknown transfer while retaining known PO metadata', async () => {
    vi.mocked(resolveScheduleRowByProductNo).mockResolvedValue(null);
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase('OTHER')]);
    expect(await verifySlipMatch(input)).toEqual({ ok: false, reason: 'transfer_not_found', legacyReason: 'TRANSFER_ORDER_UNRESOLVED', actualResolvedBy: 'purchaseOrder', actual: { fseiban: 'OTHER', partCode: 'MD123(B)-002' } });
  });
  it.each(['actualPartBarcodeRaw', 'transferPartBarcodeRaw'] as const)('retains %s checks', async (field) => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase()]);
    expect(await verifySlipMatch({ ...input, [field]: 'WRONG' })).toMatchObject({
      ok: false, reason: 'different_part', legacyReason: field === 'actualPartBarcodeRaw' ? 'ACTUAL_PART_MISMATCH' : 'TRANSFER_PART_MISMATCH', actualResolvedBy: 'purchaseOrder'
    });
  });
  it('uses the transfer row for the 製番 fallback and needs the part number', async () => {
    vi.mocked(resolveScheduleRowByProductNo).mockResolvedValue(transfer);
    vi.mocked(resolveScheduleRowByFseiban).mockResolvedValue({ ...transfer, fhincd: 'OTHER-PART' });
    const base = { ...input, actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS1' };
    expect(await verifySlipMatch(base)).toMatchObject({ ok: true, reason: 'match' });
    expect(await verifySlipMatch({ ...base, actualPartBarcodeRaw: '' })).toMatchObject({ ok: false, reason: 'part_required' });
    expect(await verifySlipMatch({ ...base, actualPartBarcodeRaw: 'WRONG' })).toMatchObject({ ok: false, reason: 'different_part' });
    vi.mocked(resolveScheduleRowByFseiban).mockResolvedValue({ ...transfer, fseiban: 'FS9' });
    expect(await verifySlipMatch({ ...base, actualFseibanRaw: 'FS9' })).toMatchObject({ ok: false, reason: 'different_seiban', actual: { fseiban: 'FS9' } });
  });

  it('retains fseiban fallback', async () => {
    vi.mocked(resolveScheduleRowByFseiban).mockResolvedValue(transfer);
    expect(await verifySlipMatch({ ...input, actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS1' })).toMatchObject({ ok: true, reason: 'match', actualResolvedBy: 'fseiban' });
  });
});
