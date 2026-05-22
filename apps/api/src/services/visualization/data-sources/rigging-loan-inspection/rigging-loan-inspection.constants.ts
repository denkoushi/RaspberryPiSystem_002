/** 吊具点検可視化テーブル列 */
export const RIGGING_INSTRUMENT_DETAIL_COLUMN = '吊具明細' as const;
export const RIGGING_RETURNED_COUNT_COLUMN = '返却件数' as const;
export const RIGGING_ACTIVE_COUNT_COLUMN = '貸出中吊具数' as const;
export const RIGGING_NAMES_COLUMN = '吊具名称一覧' as const;

export const RIGGING_LOAN_INSPECTION_TABLE_COLUMNS = [
  '従業員名',
  '点検件数',
  RIGGING_ACTIVE_COUNT_COLUMN,
  RIGGING_RETURNED_COUNT_COLUMN,
  RIGGING_NAMES_COLUMN,
  RIGGING_INSTRUMENT_DETAIL_COLUMN,
] as const;
