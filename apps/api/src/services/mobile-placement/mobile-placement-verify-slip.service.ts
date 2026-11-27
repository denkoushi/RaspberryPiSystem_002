import { verifySlipMatch as verify, type SlipPairMatchInput } from '@raspi-system/slip-match-core';

import { listScheduleRowsByFseiban, listScheduleRowsByProductNo } from '../production-schedule/production-schedule-lookup.service.js';
import { findPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';

export type { SlipVerificationResult } from '@raspi-system/slip-match-core';

export function verifySlipMatch(input: SlipPairMatchInput) {
  return verify(input, {
    listScheduleRowsByFseiban,
    listScheduleRowsByProductNo,
    findPurchaseOrderLookupRows
  });
}
