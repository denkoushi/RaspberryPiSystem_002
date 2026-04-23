/**
 * 計測機器持出状況カードの本文表示。可視化テーブル行とレンダラー間の共有型。
 */

/** 貸出中は active。返却済み（当日内の最新持出しが返却で閉じている）は returned。 */
export type MiInstrumentKind = 'active' | 'returned';

export type MiInstrumentEntry = {
  kind: MiInstrumentKind;
  managementNumber: string;
  name: string;
};

/** 本文1行。フォントサイズ・行送りは行ごとに可変。 */
export type BodyLineTone = 'primary' | 'secondary' | 'muted';

export type MiBodyLine = {
  text: string;
  fontSize: number;
  lineHeight: number;
  tone: BodyLineTone;
  /** 縦ギャップのみ。描画ではテキストを出さず lineHeight 分進める */
  isSpacer?: boolean;
};

/** 貸出中ブロック: ベース（従来 13*scale 相当）に対する倍率 */
export const ACTIVE_BODY_FONT_SCALE = 1.5;

/** 返却行: 既存本文と同じ倍率（貸出中 1.5 倍より小さく見える） */
export const RETURNED_BODY_FONT_SCALE = 1;

/** JSON 列キー（TableVisualizationData の行） */
export const MI_INSTRUMENT_DETAIL_COLUMN = '計測機器明細' as const;

/** 返却件数（当日内・表示対象の返却済み機器数） */
export const MI_RETURNED_COUNT_COLUMN = '返却件数' as const;
