import { formatPlannedQuantityLabel } from '../productionSchedule/plannedDueDisplay';

import type { LeaderBoardRow } from './types';

export type LeaderOrderRowPresentation = {
  /** 表示用: 機種記号 · 機種名 · 部品番号(ProductNo) · 品目コード(補助)。空要素は省略 */
  machinePartLine: string;
  /** 工順ラベルなし: `fkojun · fhinmei`（空は省略して中点だけにならないよう結合） */
  processPartNameLine: string;
  quantityLabel: string;
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
  const machinePartLine = joinMiddleDot([
    row.machineTypeCode,
    row.machineName,
    row.productNo,
    row.fhincd.length > 0 ? row.fhincd : ''
  ]);

  const kojun = row.fkojun.trim();
  const partName = row.fhinmei.trim();
  const processPartNameLine =
    kojun.length > 0 && partName.length > 0
      ? `${kojun} · ${partName}`
      : kojun.length > 0
        ? kojun
        : partName;

  return {
    machinePartLine,
    processPartNameLine,
    quantityLabel: formatPlannedQuantityLabel(row.plannedQuantity)
  };
}
