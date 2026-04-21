import { formatPlannedDateLabel } from '../../kiosk/productionSchedule/plannedDueDisplay';

import type { PurchaseOrderLookupRowDto } from '../../../api/client';

/**
 * キオスク購買照会: 1行分の表示モデル（ラベルなし・順序固定）。
 * 表示順は 機種名 → 製番 → 着手日 → 品名 → 品番 → 個数。
 */
export type PurchaseOrderLookupRowViewModel = {
  machineName: string;
  seiban: string;
  plannedStartDisplay: string;
  purchasePartName: string;
  /** 品名直下に出す補助（購買品名と既存DB品名が異なるときのみ） */
  hinmeiSubLine?: string;
  partCode: string;
  quantityDisplay: string;
};

export function buildPurchaseOrderRowLines(row: PurchaseOrderLookupRowDto): PurchaseOrderLookupRowViewModel {
  const purchase = row.purchasePartName.trim();
  const master = row.masterPartName.trim();
  const hinmeiSubLine =
    master.length > 0 && master !== purchase ? `既存DB: ${master}` : undefined;

  return {
    machineName: row.machineName.trim(),
    seiban: row.seiban.trim(),
    plannedStartDisplay: formatPlannedDateLabel(row.plannedStartDate ?? null),
    purchasePartName: purchase,
    hinmeiSubLine,
    partCode: row.purchasePartCodeRaw.trim(),
    quantityDisplay: String(row.acceptedQuantity)
  };
}
