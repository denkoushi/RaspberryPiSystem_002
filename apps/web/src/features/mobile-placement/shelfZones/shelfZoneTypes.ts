/**
 * 棚ゾーン（中央/東/西）— UI と将来の API 契約の共通型。
 * 表示ラベルとオーバーレイ見出しを分け、キー（id）で参照する。
 */
export type ShelfZoneId = 'central' | 'east' | 'west';

export type ShelfZoneDefinition = {
  readonly id: ShelfZoneId;
  /** ゾーン行ボタン用の短い表記（例: 中央） */
  readonly label: string;
  /** 全画面オーバーレイ見出し（例: 中央エリア） */
  readonly overlayTitle: string;
  /** そのゾーンで選べる棚番号（表示順） */
  readonly shelfCodes: readonly string[];
};

/**
 * ゾーン一覧の束（将来は API レスポンスやキャッシュに差し替え可能）
 */
export type ShelfZoneCatalog = {
  readonly zones: readonly ShelfZoneDefinition[];
};
