import type { MaterialArrivalBasis, MaterialArrivalStatus } from '@raspi-system/shared-types';

import { findMaterialArrivalStatusByPart, materialArrivalLookupKey } from '../purchase-order-lookup/material-arrival-status.service.js';

export type HaizenMaterialArrivalItem = {
  fseiban: string;
  fhincd: string;
  status: MaterialArrivalStatus;
  basis: MaterialArrivalBasis;
};

/** 配膳の納期一覧用。入力の製番+品番ごとに材料の入荷状況を返す（状況の無い部品は含めない）。 */
export async function listHaizenMaterialArrival(
  parts: ReadonlyArray<{ fseiban: string; fhincd: string }>
): Promise<{ items: HaizenMaterialArrivalItem[] }> {
  const statuses = await findMaterialArrivalStatusByPart(parts);
  const items: HaizenMaterialArrivalItem[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const dedupeKey = `${part.fseiban}\t${part.fhincd}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const found = statuses.get(materialArrivalLookupKey(part.fseiban, part.fhincd));
    if (found) items.push({ fseiban: part.fseiban, fhincd: part.fhincd, status: found.status, basis: found.basis });
  }
  return { items };
}
