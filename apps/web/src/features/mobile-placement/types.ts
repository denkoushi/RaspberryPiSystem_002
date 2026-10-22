/**
 * 配膳スマホ: どの入力がスキャン対象か（モーダルに渡す識別子）
 */
export type MobilePlacementScanField =
  | 'shelf'
  | 'order'
  | 'transferOrder'
  | 'transferPart'
  | 'actualOrder'
  | 'actualPart'
  | null;

export type MobilePlacementSlipResult = 'idle' | 'ok' | 'ng' | 'not-found' | 'error';

export type SlipColumnVariant = 'transfer' | 'actual';
