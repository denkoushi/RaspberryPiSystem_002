/**
 * 配膳スマホ: どの入力がスキャン対象か（モーダルに渡す識別子）
 */
export type MobilePlacementScanField =
  | 'shelf'
  | 'order'
  | 'transferOrder'
  | 'transferFhinmei'
  | 'actualOrder'
  | 'actualFhinmei'
  | null;

export type SlipColumnVariant = 'transfer' | 'actual';
