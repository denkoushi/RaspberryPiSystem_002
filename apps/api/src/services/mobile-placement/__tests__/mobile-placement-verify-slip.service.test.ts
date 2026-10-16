import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifySlipMatch } from '../mobile-placement-verify-slip.service.js';
import { resolveScheduleRowByProductNo, resolveScheduleRowByFseiban } from '../mobile-placement-order-lookup.js';
import { findPurchaseOrderLookupRows } from '../../purchase-order-lookup/purchase-order-lookup-query.service.js';

vi.mock('../mobile-placement-order-lookup.js', () => ({
  resolveScheduleRowByProductNo: vi.fn(), resolveScheduleRowByFseiban: vi.fn()
}));
vi.mock('../../purchase-order-lookup/purchase-order-lookup-query.service.js', () => ({ findPurchaseOrderLookupRows: vi.fn() }));

const transfer = { rowId: 'r', fseiban: ' FS1 ', productNo: 'T1', fhincd: 'MD123(A)-001', fhinmei: '', fsigencd: '', fkojun: 1 };
const input = {
  transferOrderBarcodeRaw: 'T1', transferPartBarcodeRaw: transfer.fhincd,
  actualOrderBarcodeRaw: ' 1234567890 ', actualFseibanRaw: '', actualPartBarcodeRaw: transfer.fhincd
};
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
  it('matches normalized part key and trimmed case-insensitive seiban', async () => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase()]);
    expect(await verifySlipMatch(input)).toEqual({ ok: true, actualResolvedBy: 'purchaseOrder' });
    expect(findPurchaseOrderLookupRows).toHaveBeenCalledWith('1234567890');
  });
  it('matches any candidate, not just the first', async () => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase('other'), purchase()]);
    expect(await verifySlipMatch(input)).toEqual({ ok: true, actualResolvedBy: 'purchaseOrder' });
  });
  it.each([[purchase('other')], [purchase('fs1', 'OTHER')], [purchase('other'), purchase('fs1', 'OTHER')]])('rejects unmatched candidates %#', async (...rows) => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue(rows);
    expect(await verifySlipMatch(input)).toEqual({ ok: false, reason: 'FSEIBAN_OR_PART_PAIR_MISMATCH', actualResolvedBy: 'purchaseOrder' });
  });
  it('gives ProductNo precedence', async () => {
    vi.mocked(resolveScheduleRowByProductNo).mockResolvedValue(transfer);
    expect(await verifySlipMatch(input)).toEqual({ ok: true, actualResolvedBy: 'productNo' });
    expect(findPurchaseOrderLookupRows).not.toHaveBeenCalled();
  });
  it('does not override a ProductNo pair mismatch', async () => {
    vi.mocked(resolveScheduleRowByProductNo).mockResolvedValueOnce(transfer).mockResolvedValueOnce({ ...transfer, fseiban: 'OTHER' });
    expect(await verifySlipMatch(input)).toEqual({ ok: false, reason: 'FSEIBAN_OR_PART_PAIR_MISMATCH', actualResolvedBy: 'productNo' });
    expect(findPurchaseOrderLookupRows).not.toHaveBeenCalled();
  });
  it('returns unresolved for unknown numbers', async () => {
    expect(await verifySlipMatch(input)).toEqual({ ok: false, reason: 'ACTUAL_ORDER_UNRESOLVED' });
  });
  it.each(['actualPartBarcodeRaw', 'transferPartBarcodeRaw'] as const)('retains %s checks', async (field) => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase()]);
    expect(await verifySlipMatch({ ...input, [field]: 'WRONG' })).toEqual({
      ok: false, reason: field === 'actualPartBarcodeRaw' ? 'ACTUAL_PART_MISMATCH' : 'TRANSFER_PART_MISMATCH', actualResolvedBy: 'purchaseOrder'
    });
  });
  it('retains fseiban fallback', async () => {
    vi.mocked(resolveScheduleRowByFseiban).mockResolvedValue(transfer);
    expect(await verifySlipMatch({ ...input, actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS1' })).toEqual({ ok: true, actualResolvedBy: 'fseiban' });
  });
});
