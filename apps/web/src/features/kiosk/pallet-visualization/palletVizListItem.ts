/** パレット可視化カード 1 行ぶんの表示用モデル（API DTO からマッピング） */
export type PalletVizListItem = {
  id: string;
  palletNo: number;
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName?: string | null;
  machineNameDisplay?: string | null;
  plannedStartDateDisplay?: string | null;
  plannedQuantity?: number | null;
  /** 表示からは外す（API 互換のため型に残す） */
  outsideDimensionsDisplay?: string | null;
};
