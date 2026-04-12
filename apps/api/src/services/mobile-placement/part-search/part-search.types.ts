export type PartPlacementSearchMatchSource = 'current' | 'schedule';

/**
 * 配膳スマホ向け部品名検索の1件（現在棚優先・スケジュール補助）。
 */
export type PartPlacementSearchHitDto = {
  matchSource: PartPlacementSearchMatchSource;
  displayName: string;
  matchedQuery: string;
  aliasMatchedBy: string | null;
  shelfCodeRaw: string | null;
  manufacturingOrderBarcodeRaw: string | null;
  branchNo: number | null;
  branchStateId: string | null;
  csvDashboardRowId: string | null;
  fhincd: string | null;
  fhinmei: string | null;
  fseiban: string | null;
  productNo: string | null;
};

export type PartPlacementSearchSuggestResult = {
  currentPlacements: PartPlacementSearchHitDto[];
  scheduleCandidates: PartPlacementSearchHitDto[];
};
