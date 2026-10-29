import { prisma } from '../../lib/prisma.js';
import { listKnownScheduleFseibans } from '../production-schedule/production-schedule-lookup.service.js';
import { resolveMachineNamesForPurchaseLookup } from '../purchase-order-lookup/purchase-order-lookup-machine-name.service.js';
import { findMasterFhinmeisByMatchKey, findMasterFhinmeisByNormalizedFhinCd } from '../purchase-order-lookup/purchase-order-lookup-master-part.service.js';
import { listPurchasePlannedStartCandidates } from '../purchase-order-lookup/purchase-order-lookup-planned-start.service.js';

import type { PurchaseEnrichmentTuple } from '@raspi-system/slip-match-core';

/** Complete display dictionaries; never read or page through purchase orders. */
export async function buildMobilePurchaseEnrichment(): Promise<{ rows: PurchaseEnrichmentTuple[] }> {
  const [match, normalized, dates, known, supplements] = await Promise.all([
    findMasterFhinmeisByMatchKey(), findMasterFhinmeisByNormalizedFhinCd(), listPurchasePlannedStartCandidates(),
    listKnownScheduleFseibans(), prisma.productionScheduleSeibanMachineNameSupplement.findMany({ select: { fseiban: true } })
  ]);
  const machines = await resolveMachineNamesForPurchaseLookup([...known, ...supplements.map((row) => row.fseiban)]);
  const rows: PurchaseEnrichmentTuple[] = [];
  for (const [kind, values] of [['match', match], ['normalized', normalized], ['machine', machines]] as const) {
    for (const [key, value] of Object.entries(values)) if (key && value != null) rows.push([kind, key, value]);
  }
  for (const row of dates) {
    if (row.plannedStartDate) rows.push(['date', row.seiban, row.fhincd, row.fhinmei, row.plannedStartDate.toISOString().slice(0, 10),
      row.productNo, row.completed ? 1 : 0]);
  }
  return { rows };
}
