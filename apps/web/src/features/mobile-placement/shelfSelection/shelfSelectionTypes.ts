/**
 * 棚番の3段階選択（エリア・列・2桁番号）— UI/API 境界の共通型。
 * 表示ラベルは catalog 側、保存キーは id で固定する。
 */
export type ShelfAreaId = 'west' | 'central' | 'east';

export type ShelfLineId = 'north' | 'central' | 'south';

/** 確定時に送れる最小の構造化棚番 */
export type ShelfSelection = {
  readonly areaId: ShelfAreaId;
  readonly lineId: ShelfLineId;
  /** 1〜99（2桁表示はゼロ埋め） */
  readonly slot: number;
};

export type ShelfAxisOption<T extends string> = {
  readonly id: T;
  readonly label: string;
};
