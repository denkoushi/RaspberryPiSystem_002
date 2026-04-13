import type { PartPlacementSearchSuggestResponse } from './types';

/** 探す画面では登録済み（現在棚）のみを一覧に使う */
export function selectRegisteredPlacementHits(
  data: PartPlacementSearchSuggestResponse | undefined
) {
  return data?.currentPlacements ?? [];
}
