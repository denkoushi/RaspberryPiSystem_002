import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

import { verifySlipMatch } from './mobile-placement-verify-slip.service.js';

import type { SlipVerificationResult } from './mobile-placement-verify-slip.service.js';

const RECHECK_WINDOW_MS = 30 * 86400000;

/** Same mapping the kiosk/phone uses when recording a verification (recordSlipVerify.ts). */
export function mapVerifyOutcome(result: Pick<SlipVerificationResult, 'ok' | 'reason'>): 'match' | 'mismatch' | 'not_found' {
  if (result.ok) return 'match';
  return ['part_required', 'order_not_found', 'transfer_not_found'].includes(result.reason) ? 'not_found' : 'mismatch';
}

export async function recheckUnresolvedSlipVerifyRecords({ now = new Date(), limit = 500 }: { now?: Date; limit?: number } = {}) {
  const rows = await prisma.mobileSlipVerifyRecord.findMany({
    where: {
      outcome: 'not_found', reason: { in: ['transfer_not_found', 'order_not_found'] },
      verifiedAt: { gte: new Date(now.getTime() - RECHECK_WINDOW_MS) }, recheckOutcome: null
    },
    orderBy: { verifiedAt: 'desc' }, take: limit
  });
  const counts = { checked: 0, matched: 0, mismatched: 0 };
  for (const row of rows) {
    try {
      const result = await verifySlipMatch({
        transferOrderBarcodeRaw: row.transferOrderBarcodeRaw, transferPartBarcodeRaw: row.transferPartRaw ?? '',
        actualOrderBarcodeRaw: row.actualOrderBarcodeRaw, actualFseibanRaw: row.actualFseibanRaw,
        actualPartBarcodeRaw: row.actualPartRaw ?? ''
      });
      counts.checked += 1;
      const outcome = mapVerifyOutcome(result);
      if (outcome === 'not_found') continue;
      await prisma.mobileSlipVerifyRecord.update({
        where: { id: row.id }, data: { recheckOutcome: outcome, recheckReason: result.reason, recheckedAt: now }
      });
      if (outcome === 'match') counts.matched += 1; else counts.mismatched += 1;
    } catch (error) {
      logger.error({ err: error, recordId: row.id }, '[mobile-verify-recheck] recheck failed for record');
    }
  }
  return counts;
}
