/**
 * キオスク生産スケジュールで「登録製番履歴」を複数画面間で共有するための localStorage キー。
 * サーバ側 search-state（共有 location）と整合させる前提のキーであり、画面専用の検索条件キーとは分離する。
 */
export const KIOSK_PRODUCTION_SCHEDULE_SEARCH_HISTORY_KEY = 'production-schedule-search-history';
export const KIOSK_PRODUCTION_SCHEDULE_SEARCH_HISTORY_HIDDEN_KEY =
  'production-schedule-search-history-hidden';
