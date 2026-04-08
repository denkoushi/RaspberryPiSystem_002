import type { KioskDocumentGmailIngestSchedule } from '../../../api/backup';

/** 管理画面表示用: 有効/無効ラベル */
export function formatKioskGmailIngestEnabledLabel(enabled: boolean): string {
  return enabled ? '有効' : '無効';
}

/** cron 式をそのまま表示（将来: 人間可読化をここに閉じ込められる） */
export function formatKioskGmailIngestCronExpression(schedule: string | undefined): string {
  const s = schedule?.trim();
  return s && s.length > 0 ? s : '—';
}

/** 設定配列を安全に正規化（未定義・空は空配列） */
export function normalizeKioskGmailIngestSchedules(
  entries: KioskDocumentGmailIngestSchedule[] | undefined | null
): KioskDocumentGmailIngestSchedule[] {
  if (!entries?.length) return [];
  return entries.filter((e) => e && typeof e.id === 'string' && e.id.length > 0);
}
