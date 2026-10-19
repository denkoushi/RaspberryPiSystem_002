export type InspectionPointStatus = 'empty' | 'ok' | 'ng';

export type InspectionDrawingDepthMode = 'measured' | 'through';
export type InspectionDrawingValueKind = 'numeric' | 'judgement';

export type InspectionDrawingPoint = {
  id: string;
  name: string;
  /** measurementPoint に名称とは分けて保存する表示補足 */
  threadNominal?: string;
  surfaceSide?: string;
  supplementText?: string;
  /** 深さ系: measured=数値公差 / through=通し（判定スキップ） */
  depthMode?: InspectionDrawingDepthMode;
  /** numeric=数値公差、judgement=管用ネジのOK/NG判定 */
  valueKind?: InspectionDrawingValueKind;
  /** 図面上の丸数字（1始まり・欠番あり） */
  markerNo: number;
  /** 画像内の割合 0–1（左上原点） */
  xRatio: number;
  yRatio: number;
  /** 指差し先端（任意。両方揃ったときのみ描画） */
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
  nominalRaw: string;
  upperToleranceRaw: string;
  lowerToleranceRaw: string;
  testValue: string;
  /** テンプレ項目の小数桁（候補値生成・保存に利用） */
  decimalPlaces?: number;
  /**
   * DB に絶対上下限のみあり nominalValue が null の読込スナップショット。
   * 公差欄を編集するまで保存時にそのまま復元する。
   */
  legacyAbsoluteBounds?: { lowerLimit: number; upperLimit: number };
};
