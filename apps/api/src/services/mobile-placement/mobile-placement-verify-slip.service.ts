import { evaluateSlipPairMatch, type SlipPairMatchInput, type SlipPairMatchResult } from './mobile-placement-slip-match.js';
import {
  resolveScheduleRowByFseiban,
  resolveScheduleRowByProductNo
} from './mobile-placement-order-lookup.js';
import { findPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { normalizePurchaseFhinCdForMatching } from '../purchase-order-lookup/purchase-fhincd-normalize.js';

export async function verifySlipMatch(input: SlipPairMatchInput): Promise<SlipPairMatchResult> {
  const order = input.actualOrderBarcodeRaw.trim();
  const fseiban = input.actualFseibanRaw.trim();
  const [transferRow, scheduleRow] = await Promise.all([
    resolveScheduleRowByProductNo(input.transferOrderBarcodeRaw),
    order ? resolveScheduleRowByProductNo(order) : fseiban ? resolveScheduleRowByFseiban(fseiban) : null
  ]);
  let actualRow = scheduleRow;
  let actualResolvedBy: SlipPairMatchResult['actualResolvedBy'] = scheduleRow
    ? order ? 'productNo' : 'fseiban'
    : undefined;

  if (!actualRow && /^\d{10}$/.test(order)) {
    const rows = await findPurchaseOrderLookupRows(order);
    if (rows.length > 0) {
      actualResolvedBy = 'purchaseOrder';
      if (transferRow) {
        const seiban = transferRow.fseiban.trim().toUpperCase();
        const matchKey = normalizePurchaseFhinCdForMatching(transferRow.fhincd);
        const matches = seiban.length > 0 && matchKey.length > 0 && rows.some((row) =>
          row.seiban.trim().toUpperCase() === seiban && row.purchasePartCodeMatchKey.trim() === matchKey
        );
        if (!matches) {
          return { ok: false, reason: 'FSEIBAN_OR_PART_PAIR_MISMATCH', actualResolvedBy };
        }
        // The purchase row proves the pair; use its matched schedule row for the existing part-barcode checks.
        actualRow = transferRow;
      }
    }
  }

  const result = evaluateSlipPairMatch({
    transferRow,
    actualRow,
    transferPartBarcodeRaw: input.transferPartBarcodeRaw,
    actualPartBarcodeRaw: input.actualPartBarcodeRaw
  });
  return actualResolvedBy ? { ...result, actualResolvedBy } : result;
}
