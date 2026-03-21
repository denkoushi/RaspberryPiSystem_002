/**
 * 手動順番 overview 行の表示ルール（純関数）。UI / React に依存しない。
 */

import { normalizeMachineName } from '../productionSchedule/machineName';

export type ManualOrderRowFields = {
  fseiban: string;
  fhincd: string;
  processLabel: string;
  machineName: string;
  partName: string;
};

export type ManualOrderRowPresentation = {
  /** trim 済み */
  seiban: string;
  hincd: string;
  proc: string;
  /** `normalizeMachineName` 適用済み */
  mach: string;
  part: string;
  /** 1行目: 製番 · 品番 · 工順 */
  showRowA: boolean;
  /** 2行目: 品名 · 機種名 */
  showRowB: boolean;
  /** 行コンテナの title（ツールチップ） */
  title: string;
};

/**
 * 表示可能な内容が1つも無ければ null（行ブロック自体を描画しない）。
 */
export function presentManualOrderRow(fields: ManualOrderRowFields): ManualOrderRowPresentation | null {
  const seiban = fields.fseiban.trim();
  const hincd = fields.fhincd.trim();
  const proc = fields.processLabel.trim();
  const mach = normalizeMachineName(fields.machineName);
  const part = fields.partName.trim();

  const showRowA = seiban.length > 0 || hincd.length > 0 || proc.length > 0;
  const showRowB = part.length > 0 || mach.length > 0;

  if (!showRowA && !showRowB) return null;

  const title = [seiban, hincd, proc, part, mach].filter((s) => s.length > 0).join(' · ');

  return {
    seiban,
    hincd,
    proc,
    mach,
    part,
    showRowA,
    showRowB,
    title
  };
}
