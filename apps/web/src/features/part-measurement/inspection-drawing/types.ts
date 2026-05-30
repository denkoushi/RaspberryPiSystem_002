export type InspectionPointStatus = 'empty' | 'ok' | 'ng';

export type InspectionDrawingPoint = {
  id: string;
  name: string;
  /** 画像内の割合 0–1（左上原点） */
  xRatio: number;
  yRatio: number;
  nominal: number;
  lower: number;
  upper: number;
  testValue: string;
};
