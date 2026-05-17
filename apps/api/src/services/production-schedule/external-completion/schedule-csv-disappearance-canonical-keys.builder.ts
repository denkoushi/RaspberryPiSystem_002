import type { NormalizedRowData } from '../../csv-dashboard/csv-dashboard.types.js';
import { buildFkojunstMailStatusKey } from '../fkojunst-mail-status-key.js';
import type { FkojunstMailNormalizedRow } from '../fkojunst-status-mail-sync.pipeline.js';
import { normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { buildProductionScheduleExternalCompletionKeyFromRowData } from './production-schedule-external-completion-key.js';

export type ScheduleDedupRowForDisappearance = Readonly<{ data: NormalizedRowData }>;

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

/**
 * 本体 winner 行の rowData から `FKOJUNST_Status` 照合3キー（ADR-20260509 と同系）を構築する。
 */
export function buildMailStatusTripleKeyFromScheduleRowData(data: NormalizedRowData): string | null {
  const fkojun = normalizeToken(data.FKOJUN);
  const fkoteicd = normalizeProductionScheduleResourceCd(normalizeToken(data.FSIGENCD));
  const fsezono = normalizeToken(data.ProductNo);
  if (fkojun.length === 0 || fkoteicd.length === 0 || fsezono.length === 0) {
    return null;
  }
  return buildFkojunstMailStatusKey({ fkojun, fkoteicd, fsezono });
}

function buildStatusSnapshotKeySet(rows: readonly FkojunstMailNormalizedRow[]): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    set.add(
      buildFkojunstMailStatusKey({
        fkojun: row.fkojun,
        fkoteicd: row.fkoteicd,
        fsezono: row.fsezono,
      })
    );
  }
  return set;
}

/**
 * `tA` 以下の `FKOJUNST_Status` スナップショット（dedupe 済み）と、本体 dedupe winner を3キー照合し、
 * 差分消失用の正本C current keys（外部完了論理キー）を構築する。
 */
export function buildCanonicalScheduleDisappearanceKeysFromPairedMailSnapshot(params: {
  scheduleDedupRows: readonly ScheduleDedupRowForDisappearance[];
  dedupedMailRowsAtOrBeforeReference: readonly FkojunstMailNormalizedRow[];
}): string[] {
  const mailKeySet = buildStatusSnapshotKeySet(params.dedupedMailRowsAtOrBeforeReference);
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const row of params.scheduleDedupRows) {
    const tripleKey = buildMailStatusTripleKeyFromScheduleRowData(row.data);
    if (!tripleKey || !mailKeySet.has(tripleKey)) {
      continue;
    }
    const extKey = buildProductionScheduleExternalCompletionKeyFromRowData(row.data);
    if (extKey.length === 0 || seen.has(extKey)) {
      continue;
    }
    seen.add(extKey);
    keys.push(extKey);
  }

  return keys.sort((a, b) => a.localeCompare(b));
}
