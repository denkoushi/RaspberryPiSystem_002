import { normalizePartName } from './part-name-normalize.js';
import { normalizePurchaseFhinCdForMatching, normalizePurchaseFhinCdForScheduleLookup } from './purchase-fhincd-normalize.js';

import type { LocalPurchaseRow, PurchaseEnrichmentTuple } from './snapshot.js';

/** Join display fields without changing purchase matching inputs or row order. */
export function enrichLocalPurchaseRows<T extends LocalPurchaseRow>(rows: T[], enrichment: PurchaseEnrichmentTuple[]): T[] {
  const names = { match: new Map<string, string>(), normalized: new Map<string, string>(), machine: new Map<string, string>() };
  type Selected = { productNo: bigint; completed: boolean; date: string };
  const dates = { match: new Map<string, Selected>(), normalized: new Map<string, Selected>(), name: new Map<string, Selected>() };
  const seibans = new Set(rows.flatMap((row) => row.seiban.trim() ? [row.seiban, row.seiban.trim()] : []));
  const key = (seiban: string, part: string) => `${seiban.trim()}\t${part.trim()}`;
  // Same selection as the server: latest numeric order, then its earliest incomplete process, then earliest date.
  const keepPreferred = (map: Map<string, Selected>, seiban: string, part: string, candidate: Selected) => {
    if (!seiban.trim() || !part.trim()) return;
    const k = key(seiban, part);
    const previous = map.get(k);
    if (!previous || candidate.productNo > previous.productNo ||
      (candidate.productNo === previous.productNo &&
        ((previous.completed && !candidate.completed) ||
          (candidate.completed === previous.completed && candidate.date < previous.date)))) {
      map.set(k, candidate);
    }
  };
  for (const item of enrichment) {
    if (item[0] !== 'date') { names[item[0]].set(item[1], item[2]); continue; }
    const [, seiban, code, name, date, productNo, completed] = item;
    // Match the server's raw/trimmed FSEIBAN filter before combining date candidates.
    if (!seibans.has(seiban)) continue;
    const candidate = { productNo: BigInt(productNo), completed: completed === 1, date };
    keepPreferred(dates.match, seiban, normalizePurchaseFhinCdForMatching(code), candidate);
    keepPreferred(dates.normalized, seiban, normalizePurchaseFhinCdForScheduleLookup(code), candidate);
    keepPreferred(dates.name, seiban, normalizePartName(name), candidate);
  }
  return rows.map((row) => ({ ...row,
    masterPartName: names.match.get(row.purchasePartCodeMatchKey.trim()) ?? names.normalized.get(row.purchasePartCodeNormalized.trim()) ?? '',
    machineName: names.machine.get(row.seiban.trim()) ?? '',
    plannedStartDate: dates.match.get(key(row.seiban, row.purchasePartCodeMatchKey))?.date ??
      dates.normalized.get(key(row.seiban, row.purchasePartCodeNormalized))?.date ??
      dates.name.get(key(row.seiban, normalizePartName(row.purchasePartName)))?.date ?? null
  }));
}
