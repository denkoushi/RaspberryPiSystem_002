import { evaluateSlipPairMatch, type SlipPairMatchInput } from './mobile-placement-slip-match.js';
import {
  resolveScheduleRowByFseiban,
  resolveScheduleRowByProductNo
} from './mobile-placement-order-lookup.js';

async function resolveActualSlipScheduleRow(input: SlipPairMatchInput) {
  const order = input.actualOrderBarcodeRaw.trim();
  const fseiban = input.actualFseibanRaw.trim();
  if (order.length > 0) {
    return resolveScheduleRowByProductNo(order);
  }
  if (fseiban.length > 0) {
    return resolveScheduleRowByFseiban(fseiban);
  }
  return null;
}

export async function verifySlipMatch(input: SlipPairMatchInput) {
  const [transferRow, actualRow] = await Promise.all([
    resolveScheduleRowByProductNo(input.transferOrderBarcodeRaw),
    resolveActualSlipScheduleRow(input)
  ]);

  const result = evaluateSlipPairMatch({
    transferRow,
    actualRow,
    transferPartBarcodeRaw: input.transferPartBarcodeRaw,
    actualPartBarcodeRaw: input.actualPartBarcodeRaw
  });

  return result;
}
