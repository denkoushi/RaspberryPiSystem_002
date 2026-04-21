import { BarcodeFormat } from '@zxing/library';

/**
 * 一次元バーコードのみ（要領書検索など。QR・DataMatrix 等は除外）。
 * 現場の印字形式が不明なときに広く拾う。
 */
export const BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL: BarcodeFormat[] = [
  BarcodeFormat.CODABAR,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODE_128,
  BarcodeFormat.EAN_8,
  BarcodeFormat.EAN_13,
  BarcodeFormat.ITF,
  BarcodeFormat.RSS_14,
  BarcodeFormat.RSS_EXPANDED,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.UPC_EAN_EXTENSION,
];

/**
 * 購買照会（注文番号ラベル想定）向け。探索空間を抑えてデコードを安定・高速化。
 * 現場で別形式が必要ならこの配列に追加する。
 */
export const BARCODE_FORMAT_PRESET_PURCHASE_ORDER: BarcodeFormat[] = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
];

/**
 * 一次元 + 主要な二次元（汎用画面向け）。
 */
export const BARCODE_FORMAT_PRESET_ALL_COMMON: BarcodeFormat[] = [
  ...BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
  BarcodeFormat.PDF_417,
  BarcodeFormat.MAXICODE,
];
