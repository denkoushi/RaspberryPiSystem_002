import { normalizeMachineName } from '../productionSchedule/machineName';
import { formatPlannedQuantityInlineJa } from '../productionSchedule/plannedDueDisplay';

import type { LeaderBoardRow } from './types';

export type LeaderOrderRowPresentation = {
  /**
   * 従来の1行連結（互換・テスト用）。機種記号 · 機種名 · 製番 · 品目コード（補助）。
   * ProductNo（製造order）は表示しない。
   */
  machinePartLine: string;
  /**
   * 順位ボード1行目クラスタ用: 製番・品目コード（空は含めない）。
   */
  clusterSegments: string[];
  /**
   * 品名の下: 機種記号 · 機種名（いずれも空なら空文字）。
   */
  machineTypeNameLine: string;
  /** 品名のみ（工順は上段インライン表示） */
  partNameLine: string;
  /** 数量サフィックス（例 `3個`）。無ければ null */
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

  const clusterSegments: string[] = [];
  if (fseiban.length > 0) {
    clusterSegments.push(fseiban);
  }
  if (row.fhincd.length > 0) {
    clusterSegments.push(row.fhincd.trim());
  }

  const machineTypeNameLine = joinMiddleDot([row.machineTypeCode, machineNameNormalized]);

  const partNameLine = row.fhinmei.trim();

  return {
    machinePartLine,
    clusterSegments,
    machineTypeNameLine,
    partNameLine,
    quantityInlineJa: formatPlannedQuantityInlineJa(row.plannedQuantity)
  };
}
