import { verifySlipMatch as verify, type SlipPairMatchInput } from '@raspi-system/slip-match-core';

import { resolveScheduleRowByFseiban, resolveScheduleRowByProductNo } from './mobile-placement-order-lookup.js';
import { findPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';

export type { SlipVerificationResult } from '@raspi-system/slip-match-core';

export function verifySlipMatch(input: SlipPairMatchInput) {
  return verify(input, {
    listScheduleRowsByFseiban: async (value) => { const row = await resolveScheduleRowByFseiban(value); return row ? [row] : []; },
    listScheduleRowsByProductNo: async (value) => { const row = await resolveScheduleRowByProductNo(value); return row ? [row] : []; },
    findPurchaseOrderLookupRows
  });
}
