import { prisma } from '../../lib/prisma.js';
import {
  findMasterFhinmeisByMatchKey,
  findMasterFhinmeisByNormalizedFhinCd,
} from './purchase-order-lookup-master-part.service.js';
import { resolveMachineNamesForPurchaseLookup } from './purchase-order-lookup-machine-name.service.js';
import { findEarliestPlannedStartDatesForPurchaseRows } from './purchase-order-lookup-planned-start.service.js';

export type PurchaseOrderLookupRowDto = {
  seiban: string;
  purchasePartName: string;
  masterPartName: string;
  machineName: string;
  purchasePartCodeRaw: string;
  purchasePartCodeNormalized: string;
  acceptedQuantity: number;
  /** 生産日程補助の着手日（ISO 日付 `YYYY-MM-DD`、無ければ null） */
  plannedStartDate: string | null;
};

export type PurchaseOrderLookupResponse = {
  purchaseOrderNo: string;
  rows: PurchaseOrderLookupRowDto[];
};

export function findPurchaseOrderLookupRows(purchaseOrderNo: string) {
  return prisma.purchaseOrderLookupRow.findMany({
    where: { purchaseOrderNo },
    orderBy: [{ lineIndex: 'asc' }, { id: 'asc' }],
  });
}

export async function queryPurchaseOrderLookup(purchaseOrderNo: string): Promise<PurchaseOrderLookupResponse> {
  const rows = await findPurchaseOrderLookupRows(purchaseOrderNo);

  const [
    masterPartNamesByMatchKey,
    masterPartNamesByNormalized,
    machineNames,
    plannedStartDates,
  ] = await Promise.all([
    findMasterFhinmeisByMatchKey(rows.map((row) => row.purchasePartCodeMatchKey)),
    findMasterFhinmeisByNormalizedFhinCd(rows.map((row) => row.purchasePartCodeNormalized)),
    resolveMachineNamesForPurchaseLookup(rows.map((row) => row.seiban)),
    findEarliestPlannedStartDatesForPurchaseRows(rows),
  ]);

  const out: PurchaseOrderLookupRowDto[] = rows.map((r, index) => {
    const mk = r.purchasePartCodeMatchKey.trim();
    const normalized = r.purchasePartCodeNormalized.trim();
    const masterPartName = masterPartNamesByMatchKey[mk] ?? masterPartNamesByNormalized[normalized] ?? '';
    const machineName = machineNames[r.seiban.trim()] ?? '';
    const startDate = plannedStartDates[index];
    return {
      seiban: r.seiban,
      purchasePartName: r.purchasePartName,
      masterPartName,
      machineName,
      purchasePartCodeRaw: r.purchasePartCodeRaw,
      purchasePartCodeNormalized: r.purchasePartCodeNormalized,
      acceptedQuantity: r.acceptedQuantity,
      plannedStartDate: startDate != null ? startDate.toISOString().slice(0, 10) : null,
    };
  });

  return { purchaseOrderNo, rows: out };
}
