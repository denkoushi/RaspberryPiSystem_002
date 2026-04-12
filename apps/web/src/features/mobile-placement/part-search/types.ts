export type PartPlacementSearchMatchSource = 'current' | 'schedule';

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

export type PartPlacementSearchSuggestResponse = {
  currentPlacements: PartPlacementSearchHitDto[];
  scheduleCandidates: PartPlacementSearchHitDto[];
};
