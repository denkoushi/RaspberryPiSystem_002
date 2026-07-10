/** 作成画面の既存図面ピッカー検索上限 */
export const INSPECTION_DRAWING_VISUAL_PICKER_LIMIT = 80;

/** 検査図面ハブの visual ライブラリ初期/検索表示上限 */
export const INSPECTION_DRAWING_VISUAL_LIBRARY_LIMIT = 40;

/** 40件超過を追加ページなしで検出するため、APIから1件だけ余分に取得する。 */
export const INSPECTION_DRAWING_VISUAL_LIBRARY_FETCH_LIMIT =
  INSPECTION_DRAWING_VISUAL_LIBRARY_LIMIT + 1;

/** 図面ライブラリ一覧の並び（最近更新順） */
export const INSPECTION_DRAWING_VISUAL_LIBRARY_SORT = 'recentlyUpdated' as const;

export const INSPECTION_DRAWING_VISUAL_SEARCH_DEBOUNCE_MS = 400;
