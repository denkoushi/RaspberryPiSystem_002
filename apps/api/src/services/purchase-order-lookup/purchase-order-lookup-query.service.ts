import { prisma } from '../../lib/prisma.js';
import { findMasterFhinmeisByNormalizedFhinCd } from './purchase-order-lookup-master-part.service.js';
import { resolveMachineNamesForPurchaseLookup } from './purchase-order-lookup-machine-name.service.js';

export type PurchaseOrderLookupRowDto = {
  seiban: string;
  purchasePartName: string;
  masterPartName: string;
  machineName: string;
  purchasePartCodeRaw: string;
  purchasePartCodeNormalized: string;
  acceptedQuantity: number;
};

export type PurchaseOrderLookupResponse = {
  purchaseOrderNo: string;
  rows: PurchaseOrderLookupRowDto[];
};

export async function queryPurchaseOrderLookup(purchaseOrderNo: string): Promise<PurchaseOrderLookupResponse> {
  const rows = await prisma.purchaseOrderLookupRow.findMany({
    where: { purchaseOrderNo },
    orderBy: [{ lineIndex: 'asc' }, { id: 'asc' }],
  });

  const [masterPartNames, machineNames] = await Promise.all([
    findMasterFhinmeisByNormalizedFhinCd(rows.map((row) => row.purchasePartCodeNormalized)),
    resolveMachineNamesForPurchaseLookup(rows.map((row) => row.seiban)),
  ]);

  const out: PurchaseOrderLookupRowDto[] = rows.map((r) => {
    const masterPartName = masterPartNames[r.purchasePartCodeNormalized.trim()] ?? '';
    const machineName = machineNames[r.seiban.trim()] ?? '';
    return {
      seiban: r.seiban,
      purchasePartName: r.purchasePartName,
      masterPartName,
      machineName,
      purchasePartCodeRaw: r.purchasePartCodeRaw,
      purchasePartCodeNormalized: r.purchasePartCodeNormalized,
      acceptedQuantity: r.acceptedQuantity,
    };
  });

  return { purchaseOrderNo, rows: out };
}
