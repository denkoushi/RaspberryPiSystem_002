/**
 * 持出・点検可視化カードの本文表示。DataSource と Renderer 間の共有型。
 */

/** 貸出中は active。返却済みは returned。 */
export type LoanInspectionInstrumentKind = 'active' | 'returned';

export type LoanInspectionInstrumentEntry = {
  kind: LoanInspectionInstrumentKind;
  managementNumber: string;
  name: string;
};

/** 本文1行。フォントサイズ・行送りは行ごとに可変。 */
export type BodyLineTone = 'primary' | 'secondary' | 'muted';

export type LoanInspectionBodyLine = {
  text: string;
  fontSize: number;
  lineHeight: number;
  tone: BodyLineTone;
  /** 縦ギャップのみ。描画ではテキストを出さず lineHeight 分進める */
  isSpacer?: boolean;
};

/** 貸出中ブロック: ベース（従来 13*scale 相当）に対する倍率 */
export const ACTIVE_BODY_FONT_SCALE = 1.5;

/** 返却行: 既存本文と同じ倍率 */
export const RETURNED_BODY_FONT_SCALE = 1;

export type LoanInspectionTableRow = Record<string, string | number | null>;
