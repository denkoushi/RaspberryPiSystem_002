import {
  SELF_INSPECTION_REDUCTION_VERDICT_LABELS,
  judgeSelfInspectionReduction,
  selfInspectionPiecesPerLot,
  type SelfInspectionReductionJudgement,
  type SelfInspectionReductionPolicy,
  type SelfInspectionReductionVerdict
} from '@raspi-system/shared-types';

import type {
  SelfInspectionChangePointKind,
  SelfInspectionReductionPart,
  SelfInspectionReductionPartKey
} from '../../../api/client';

export type ReductionRow = {
  id: string;
  part: SelfInspectionReductionPart;
  judgement: SelfInspectionReductionJudgement;
};

export type ReductionVerdictFilter = SelfInspectionReductionVerdict | null;
export type ReductionProcessFilter = 'all' | 'cutting' | 'grinding';

export const REDUCTION_VERDICT_ORDER: SelfInspectionReductionVerdict[] = [
  'restore',
  'reduce',
  'almost',
  'keep',
  'unjudgeable'
];

export const REDUCTION_VERDICT_LABELS = SELF_INSPECTION_REDUCTION_VERDICT_LABELS;

export const REDUCTION_PROCESS_LABELS: Record<SelfInspectionReductionPartKey['processGroup'], string> = {
  cutting: '切削',
  grinding: '研削'
};

export const CHANGE_POINT_KIND_LABELS: Record<SelfInspectionChangePointKind, string> = {
  TOOL_CHANGE: '刃具交換',
  SETUP_CHANGE: '段取り替え',
  MATERIAL_LOT: '材料ロット',
  MACHINE_REPAIR: '機械修理',
  PROGRAM_CHANGE: 'プログラム変更',
  OTHER: 'その他'
};

export const CHANGE_POINT_KINDS = Object.keys(CHANGE_POINT_KIND_LABELS) as SelfInspectionChangePointKind[];

export function reductionPartId(key: SelfInspectionReductionPartKey): string {
  return `${key.fhincd}/${key.processGroup}/${key.resourceCd}`;
}

export function buildReductionRows(
  parts: readonly SelfInspectionReductionPart[],
  policy: SelfInspectionReductionPolicy
): ReductionRow[] {
  return parts
    .map((part) => ({
      id: reductionPartId(part.key),
      part,
      judgement: judgeSelfInspectionReduction(part.metrics, policy)
    }))
    .sort(
      (a, b) =>
        REDUCTION_VERDICT_ORDER.indexOf(a.judgement.verdict) - REDUCTION_VERDICT_ORDER.indexOf(b.judgement.verdict) ||
        (b.part.metrics.worstCpk ?? -1) - (a.part.metrics.worstCpk ?? -1) ||
        a.id.localeCompare(b.id, 'ja')
    );
}

export function filterReductionRows(
  rows: readonly ReductionRow[],
  filter: { verdict: ReductionVerdictFilter; process: ReductionProcessFilter; query: string }
): ReductionRow[] {
  const query = filter.query.trim().toUpperCase();
  return rows.filter(
    (row) =>
      (!filter.verdict || row.judgement.verdict === filter.verdict) &&
      (filter.process === 'all' || row.part.key.processGroup === filter.process) &&
      (!query ||
        row.part.key.fhincd.toUpperCase().includes(query) ||
        row.part.key.resourceCd.toUpperCase().includes(query) ||
        row.part.fhinmei.toUpperCase().includes(query))
  );
}

export function countReductionVerdicts(rows: readonly ReductionRow[]): Record<SelfInspectionReductionVerdict, number> {
  const counts: Record<SelfInspectionReductionVerdict, number> = {
    reduce: 0,
    almost: 0,
    keep: 0,
    restore: 0,
    unjudgeable: 0
  };
  for (const row of rows) counts[row.judgement.verdict] += 1;
  return counts;
}

/** 「減らせる」を1段下げたときに、月あたり測らずに済む個数と時間。 */
export function estimateMonthlySavings(
  rows: readonly ReductionRow[],
  secondsPerPiece: number | null
): { pieces: number; hours: number | null } {
  let pieces = 0;
  for (const row of rows) {
    const target = row.judgement.target;
    if (row.judgement.verdict !== 'reduce' || !target) continue;
    const { level, lotSize } = row.part.metrics;
    pieces +=
      (selfInspectionPiecesPerLot(level, lotSize) - selfInspectionPiecesPerLot(target, lotSize)) *
      row.part.lotsPerMonth;
  }
  const rounded = Math.round(pieces);
  return { pieces: rounded, hours: secondsPerPiece == null ? null : (pieces * secondsPerPiece) / 3600 };
}

export type CpkMarginTone = 'ample' | 'enough' | 'tight' | 'short' | 'none';

export function cpkMargin(cpk: number | null): { tone: CpkMarginTone; label: string } {
  if (cpk == null) return { tone: 'none', label: '—' };
  if (cpk >= 1.67) return { tone: 'ample', label: 'たっぷり' };
  if (cpk >= 1.33) return { tone: 'enough', label: 'あり' };
  if (cpk >= 1) return { tone: 'tight', label: 'ぎりぎり' };
  return { tone: 'short', label: '足りない' };
}

export function formatCpk(cpk: number | null): string {
  return cpk == null ? '—' : cpk.toFixed(2);
}

export function formatLimit(value: number, decimalPlaces: number): string {
  return value.toFixed(Math.min(Math.max(decimalPlaces, 0), 4));
}

export function worstItem(part: SelfInspectionReductionPart) {
  return part.items.find((item) => item.key === part.worstItemKey) ?? part.items[0] ?? null;
}
