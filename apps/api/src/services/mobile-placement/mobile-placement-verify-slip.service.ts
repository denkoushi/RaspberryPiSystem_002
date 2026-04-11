import { evaluateSlipPairMatch, type SlipPairMatchInput } from './mobile-placement-slip-match.js';
import { resolveScheduleRowByProductNo } from './mobile-placement-order-lookup.js';

export async function verifySlipMatch(input: SlipPairMatchInput) {
  const [transferRow, actualRow] = await Promise.all([
    resolveScheduleRowByProductNo(input.transferOrderBarcodeRaw),
    resolveScheduleRowByProductNo(input.actualOrderBarcodeRaw)
  ]);

  const result = evaluateSlipPairMatch({
    transferRow,
    actualRow,
    transferFhinmeiBarcodeRaw: input.transferFhinmeiBarcodeRaw,
    actualFhinmeiBarcodeRaw: input.actualFhinmeiBarcodeRaw
  });

  return result;
}
