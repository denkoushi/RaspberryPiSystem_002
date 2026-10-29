import { normalizePartName } from './part-name-normalize.js';
import { normalizePurchaseFhinCdForMatching, normalizePurchaseFhinCdForScheduleLookup } from './purchase-fhincd-normalize.js';

import type { LocalPurchaseRow, PurchaseEnrichmentTuple } from './snapshot.js';

/** Join display fields without changing purchase matching inputs or row order. */
export function enrichLocalPurchaseRows<T extends LocalPurchaseRow>(rows: T[], enrichment: PurchaseEnrichmentTuple[]): T[] {
  const names = { match: new Map<string, string>(), normalized: new Map<string, string>(), machine: new Map<string, string>() };
  const dates = { match: new Map<string, string>(), normalized: new Map<string, string>(), name: new Map<string, string>() };
  const seibans = new Set(rows.flatMap((row) => row.seiban.trim() ? [row.seiban, row.seiban.trim()] : []));
  const key = (seiban: string, part: string) => `${seiban.trim()}\t${part.trim()}`;
  const keepEarliest = (map: Map<string, string>, seiban: string, part: string, date: string) => {
    if (!seiban.trim() || !part.trim()) return;
    const k = key(seiban, part);
    if (!map.has(k) || date < map.get(k)!) map.set(k, date);
  };
  for (const item of enrichment) {
    if (item[0] !== 'date') { names[item[0]].set(item[1], item[2]); continue; }
    const [, seiban, code, name, date] = item;
    // Match the server's raw/trimmed FSEIBAN filter before combining date candidates.
    if (!seibans.has(seiban)) continue;
    keepEarliest(dates.match, seiban, normalizePurchaseFhinCdForMatching(code), date);
    keepEarliest(dates.normalized, seiban, normalizePurchaseFhinCdForScheduleLookup(code), date);
    keepEarliest(dates.name, seiban, normalizePartName(name), date);
  }
  return rows.map((row) => ({ ...row,
    masterPartName: names.match.get(row.purchasePartCodeMatchKey.trim()) ?? names.normalized.get(row.purchasePartCodeNormalized.trim()) ?? '',
    machineName: names.machine.get(row.seiban.trim()) ?? '',
    plannedStartDate: dates.match.get(key(row.seiban, row.purchasePartCodeMatchKey)) ??
      dates.normalized.get(key(row.seiban, row.purchasePartCodeNormalized)) ??
      dates.name.get(key(row.seiban, normalizePartName(row.purchasePartName))) ?? null
  }));
}
