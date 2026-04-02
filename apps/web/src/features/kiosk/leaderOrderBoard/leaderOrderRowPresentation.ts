import { normalizeMachineName } from '../productionSchedule/machineName';
import { formatPlannedQuantityInlineJa } from '../productionSchedule/plannedDueDisplay';

import type { LeaderBoardRow } from './types';

export type LeaderOrderRowPresentation = {
  /**
   * 子カード2行目: 機種記号 · 機種名 · 製番 · 品目コード（補助）。
   * ProductNo（製造order）は表示しない（順位ボード子行では製番優先のため）。
   */
  machinePartLine: string;
  /** 子カード3行目: 品名のみ（工順は上段インライン表示） */
  partNameLine: string;
  /** 子行2行目付近の数量サフィックス（例 `3個`）。無ければ null */
  quantityInlineJa: string | null;
};

const joinMiddleDot = (parts: string[]): string =>
  parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(' · ');

/**
 * 子カード1行ぶんの表示用テキスト（ラベル語なし）。
 */
export function presentLeaderOrderRow(row: LeaderBoardRow): LeaderOrderRowPresentation {
  const machineNameNormalized = normalizeMachineName(row.machineName);
  const fseiban = String(row.fseiban ?? '').trim();
  const machinePartLine = joinMiddleDot([
    row.machineTypeCode,
    machineNameNormalized,
    fseiban.length > 0 ? fseiban : '',
    row.fhincd.length > 0 ? row.fhincd : ''
  ]);

  const partNameLine = row.fhinmei.trim();

  return {
    machinePartLine,
    partNameLine,
    quantityInlineJa: formatPlannedQuantityInlineJa(row.plannedQuantity)
  };
}
