/**
 * FKOJUNST_Status メール CSV の完了扱いステータス（S/R は進行中のため未完了）。
 * 判定は DB 側 SQL と同期すること（リポジトリの IN 句）。
 */
export const FKOJUNST_MAIL_COMPLETED_STATUS_CODES = ['C', 'P', 'X', 'O'] as const;

export type FkojunstMailCompletedStatusCode = (typeof FKOJUNST_MAIL_COMPLETED_STATUS_CODES)[number];
