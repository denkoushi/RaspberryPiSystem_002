/**
 * 手動順番 overview 行の表示ルール（純関数）。UI / React に依存しない。
 */

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
  mach: string;
  part: string;
  showLine1: boolean;
  showLine2: boolean;
  showLine3: boolean;
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
  const mach = fields.machineName.trim();
  const part = fields.partName.trim();

  const showLine1 = seiban.length > 0 || hincd.length > 0;
  const showLine2 = proc.length > 0 || part.length > 0;
  const showLine3 = mach.length > 0;

  if (!showLine1 && !showLine2 && !showLine3) return null;

  const title = [seiban, hincd, proc, part, mach].filter((s) => s.length > 0).join(' · ');

  return {
    seiban,
    hincd,
    proc,
    mach,
    part,
    showLine1,
    showLine2,
    showLine3,
    title
  };
}
