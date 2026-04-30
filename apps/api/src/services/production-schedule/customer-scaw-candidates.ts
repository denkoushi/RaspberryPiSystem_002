import { normalizeCustomerScawMatchKey } from './customer-scaw-normalize.js';
import { parseCustomerScawFankenymdUtcDayMs } from './customer-scaw-fankenymd.js';

export type CustomerScawCsvCandidate = {
  customerName: string;
  fankenymdUtcDayMs: number | null;
  scanIndex: number;
};

/**
 * CustomerSCAW 取込行を FANKENMEI 正規化キーごとの候補リストへ変換する。
 * 同一キー内の順序は CSV 走査順（`scanIndex` 昇順）。
 */
export function buildFankenmeiKeyToCandidates(
  orderedRows: Array<{ rowData: Record<string, unknown> }>
): Map<string, CustomerScawCsvCandidate[]> {
  const map = new Map<string, CustomerScawCsvCandidate[]>();
  let scanIndex = 0;
  for (const { rowData } of orderedRows) {
    const fankRaw = rowData.FANKENMEI;
    const custRaw = rowData.Customer;
    const key = normalizeCustomerScawMatchKey(fankRaw);
    const customer = String(custRaw ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ');
    if (key.length === 0 || customer.length === 0) {
      scanIndex += 1;
      continue;
    }
    const fankenymdUtcDayMs = parseCustomerScawFankenymdUtcDayMs(rowData.FANKENYMD);
    const candidate: CustomerScawCsvCandidate = { customerName: customer, fankenymdUtcDayMs, scanIndex };
    const list = map.get(key);
    if (list) {
      list.push(candidate);
    } else {
      map.set(key, [candidate]);
    }
    scanIndex += 1;
  }
  return map;
}

const utcDayMsFromDate = (d: Date): number =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * 着手日があるとき: パース可能な `FANKENYMD` がある候補だけで最短日付距離を取り、
 * 同距離は `FANKENYMD <= 着手日（UTC日）` を優先し、さらに同率なら CSV 後勝ち（`scanIndex` 最大）。
 *
 * 着手日が無い／不正、またはパース可能な `FANKENYMD` が無いとき: CSV 後勝ち。
 */
export function pickCustomerNameFromCandidates(
  candidates: CustomerScawCsvCandidate[] | undefined,
  plannedStartDate: Date | null | undefined
): string | null {
  if (!candidates || candidates.length === 0) {
    return null;
  }
  const lastWin = candidates[candidates.length - 1]!;

  const start = plannedStartDate;
  if (!start || Number.isNaN(start.getTime())) {
    return lastWin.customerName;
  }

  const startMs = utcDayMsFromDate(start);
  const dated = candidates.filter((c) => c.fankenymdUtcDayMs !== null);
  if (dated.length === 0) {
    return lastWin.customerName;
  }

  let bestDist = Infinity;
  let best: CustomerScawCsvCandidate[] = [];
  for (const c of dated) {
    const ymd = c.fankenymdUtcDayMs!;
    const dist = Math.abs(ymd - startMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = [c];
    } else if (dist === bestDist) {
      best.push(c);
    }
  }

  if (best.length === 1) {
    return best[0]!.customerName;
  }

  const pastOrSame = best.filter((c) => c.fankenymdUtcDayMs! <= startMs);
  const pool = pastOrSame.length > 0 ? pastOrSame : best;
  pool.sort((a, b) => a.scanIndex - b.scanIndex);
  return pool[pool.length - 1]!.customerName;
}
