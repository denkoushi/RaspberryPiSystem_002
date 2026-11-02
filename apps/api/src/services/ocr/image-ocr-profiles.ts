/**
 * 画像 OCR の用途別プロファイル（ImageOcrPort の optional 入力）。
 * 具体エンジン設定は adapter 内に閉じ、route / UI には漏らさない。
 */
export type ImageOcrProfile =
  /** 検査図面の寸法数値候補。座標付き OCR で数字・小数・符号を優先する */
  | 'partMeasurementDrawingDimensions';
