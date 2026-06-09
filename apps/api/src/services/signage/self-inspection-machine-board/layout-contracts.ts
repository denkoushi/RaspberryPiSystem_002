/** 1920x1080 標準表示で 1 ページに収まる部品行数（製番見出し分を除く） */
export const SUMMARY_PART_ROWS_PER_PAGE = 12;
export const DEFAULT_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE = SUMMARY_PART_ROWS_PER_PAGE;
export const MAX_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE = SUMMARY_PART_ROWS_PER_PAGE;
export const DEFAULT_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N = 5;
export const MAX_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N = 20;
/** 自主検査ボードが 1 回の集約で扱う生産日程行の総件数上限 */
export const MAX_SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_ROWS = 2000;
/** DB 取得時の内部ページサイズ（総件数上限とは別） */
export const SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_FETCH_PAGE_SIZE = 500;
/** 詳細ヒートストリップの横方向セル上限（FULL モード大量 entry 対策） */
export const MAX_HEATSTRIP_ENTRY_COLUMNS = 32;
/** 詳細 1 ページに描画する測定点数上限 */
export const MAX_DETAIL_MEASUREMENT_POINTS = 24;
/** auto モードで連結する機種数の既定 */
export const DEFAULT_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES = 5;
/** auto モードで連結する機種数の上限 */
export const MAX_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES = 20;
/** auto 候補抽出時の生産日程行取得上限（順位ボード相当） */
export const MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS = 2000;
/** auto 候補抽出時の board build 並列度 */
export const SELF_INSPECTION_MACHINE_BOARD_AUTO_BUILD_CONCURRENCY = 2;
/** auto ローテーション ViewModel の render 跨ぎ TTL（候補走査 + 機種別ボード構築の再利用） */
export const SELF_INSPECTION_MACHINE_BOARD_AUTO_ROTATION_VM_CACHE_TTL_MS = 60_000;
