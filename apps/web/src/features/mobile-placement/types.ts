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

export type MobilePlacementSlipResult = 'idle' | 'ok' | 'ng';

export type SlipColumnVariant = 'transfer' | 'actual';

/** 配膳トップ: 新規登録 / 棚移動 のどちらを実行中か（ボタン表示用） */
export type MobilePlacementRegisterSubmittingAction = 'create' | 'move' | null;
