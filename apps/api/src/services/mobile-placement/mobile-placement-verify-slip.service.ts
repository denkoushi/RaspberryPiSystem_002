import { normalizePartName } from '../../lib/part-name-normalize.js';
import { evaluateSlipPairMatch, type SlipPairMatchInput, type SlipPairMatchResult } from './mobile-placement-slip-match.js';
import {
  resolveScheduleRowByFseiban,
  resolveScheduleRowByProductNo
} from './mobile-placement-order-lookup.js';
import { findPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { normalizePurchaseFhinCdForMatching } from '../purchase-order-lookup/purchase-fhincd-normalize.js';

export type SlipVerificationResult = {
  ok: boolean;
  reason: 'match' | 'different_seiban' | 'different_part' | 'part_required' | 'order_not_found' | 'transfer_not_found';
  legacyReason?: Extract<SlipPairMatchResult, { ok: false }>['reason'];
  actualResolvedBy?: SlipPairMatchResult['actualResolvedBy'];
  expected?: { fseiban: string; fhincd: string; partName?: string };
  actual?: { fseiban?: string; partCode?: string };
  /** 'part_name': the 現品票 carries a material code, so the pair was matched by 製番 and part name. */
  matchedBy?: 'part_name';
};

export async function verifySlipMatch(input: SlipPairMatchInput): Promise<SlipVerificationResult> {
  const order = input.actualOrderBarcodeRaw.trim();
  const fseiban = input.actualFseibanRaw.trim();
  const [transferRow, scheduleRow] = await Promise.all([
    resolveScheduleRowByProductNo(input.transferOrderBarcodeRaw),
    order ? resolveScheduleRowByProductNo(order) : fseiban ? resolveScheduleRowByFseiban(fseiban) : null
  ]);
  const expected = transferRow ? {
    fseiban: transferRow.fseiban.trim(), fhincd: transferRow.fhincd.trim(),
    ...(transferRow.fhinmei ? { partName: transferRow.fhinmei } : {})
  } : undefined;
  let actualRow = scheduleRow;
  let actual = scheduleRow ? { fseiban: scheduleRow.fseiban.trim(), partCode: scheduleRow.fhincd.trim() } : undefined;
  let matchedBy: SlipVerificationResult['matchedBy'];
  let actualResolvedBy: SlipPairMatchResult['actualResolvedBy'] = scheduleRow
    ? order ? 'productNo' : 'fseiban'
    : undefined;

  // A 製番 alone names many parts, so the printed-製番 fallback also needs the 現品票 part number.
  if (!order && scheduleRow && transferRow) {
    if (scheduleRow.fseiban.trim().toUpperCase() !== transferRow.fseiban.trim().toUpperCase()) {
      return { ok: false, reason: 'different_seiban', legacyReason: 'FSEIBAN_OR_PART_PAIR_MISMATCH', actualResolvedBy, expected, actual: { fseiban: scheduleRow.fseiban.trim() } };
    }
    if (!input.actualPartBarcodeRaw?.trim()) {
      return { ok: false, reason: 'part_required', actualResolvedBy, expected, actual: { fseiban: scheduleRow.fseiban.trim() } };
    }
    actualRow = transferRow;
    actual = { fseiban: scheduleRow.fseiban.trim(), partCode: input.actualPartBarcodeRaw.trim() };
  }

  if (!actualRow && /^\d{10}$/.test(order)) {
    const rows = await findPurchaseOrderLookupRows(order);
    if (rows.length > 0) {
      actualResolvedBy = 'purchaseOrder';
      const sameSeiban = rows.filter((row) => row.seiban.trim().toUpperCase() === transferRow?.fseiban.trim().toUpperCase());
      const codeMatched = transferRow && sameSeiban.find((row) =>
        row.purchasePartCodeMatchKey.trim() === normalizePurchaseFhinCdForMatching(transferRow.fhincd) &&
        row.purchasePartCodeMatchKey.trim().length > 0 && row.seiban.trim().length > 0
      );
      const transferName = normalizePartName(transferRow?.fhinmei ?? '');
      const nameMatched = !codeMatched && transferName
        ? sameSeiban.find((row) => normalizePartName(row.purchasePartName) === transferName)
        : undefined;
      const matched = codeMatched || nameMatched;
      const candidate = matched || sameSeiban[0] || rows[0];
      actual = { fseiban: candidate.seiban.trim(), partCode: candidate.purchasePartCodeRaw };
      if (transferRow && !matched) {
        return { ok: false, reason: sameSeiban.length ? 'different_part' : 'different_seiban',
          legacyReason: 'FSEIBAN_OR_PART_PAIR_MISMATCH', actualResolvedBy, expected, actual };
      }
      // The purchase row proves the pair; retain the existing checks for supplied part barcodes.
      if (matched) actualRow = transferRow;
      if (nameMatched) matchedBy = 'part_name';
    }
  }

  const result = evaluateSlipPairMatch({
    transferRow, actualRow,
    transferPartBarcodeRaw: input.transferPartBarcodeRaw,
    actualPartBarcodeRaw: input.actualPartBarcodeRaw
  });
  const reason: SlipVerificationResult['reason'] = result.ok ? 'match'
    : result.reason === 'TRANSFER_ORDER_UNRESOLVED' ? 'transfer_not_found'
    : result.reason === 'ACTUAL_ORDER_UNRESOLVED' ? 'order_not_found'
    : result.reason === 'FSEIBAN_OR_PART_PAIR_MISMATCH' &&
      transferRow?.fseiban.trim().toUpperCase() !== actualRow?.fseiban.trim().toUpperCase() ? 'different_seiban'
    : 'different_part';
  return { ok: result.ok, reason, ...(!result.ok ? { legacyReason: result.reason } : {}),
    ...(actualResolvedBy ? { actualResolvedBy } : {}), ...(expected ? { expected } : {}), ...(actual ? { actual } : {}),
    ...(result.ok && matchedBy ? { matchedBy } : {}) };
}
