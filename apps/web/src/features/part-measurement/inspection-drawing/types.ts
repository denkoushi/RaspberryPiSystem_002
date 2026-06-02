export type InspectionPointStatus = 'empty' | 'ok' | 'ng';

export type InspectionDrawingPoint = {
  id: string;
  name: string;
  /** 図面上の丸数字（1始まり・欠番あり） */
  markerNo: number;
  /** 画像内の割合 0–1（左上原点） */
  xRatio: number;
  yRatio: number;
  nominalRaw: string;
  upperToleranceRaw: string;
  lowerToleranceRaw: string;
  testValue: string;
  /**
   * DB に絶対上下限のみあり nominalValue が null の読込スナップショット。
   * 公差欄を編集するまで保存時にそのまま復元する。
   */
  legacyAbsoluteBounds?: { lowerLimit: number; upperLimit: number };
};
