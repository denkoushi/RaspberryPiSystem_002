const FALLBACK = '—';

let draftUpdatedAtFormatter: Intl.DateTimeFormat | null = null;

function getDraftUpdatedAtFormatter(): Intl.DateTimeFormat {
  if (!draftUpdatedAtFormatter) {
    draftUpdatedAtFormatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
  return draftUpdatedAtFormatter;
}

/**
 * キオスク部品測定下書き一覧の更新日時表示用。
 * - 曜日（短縮・日本語）
 * - 時刻は分まで（秒なし）
 * - 現場表示の揃え用に Asia/Tokyo 固定
 */
export function formatKioskPartMeasurementDraftUpdatedAt(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) {
    return FALLBACK;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return FALLBACK;
  }
  return getDraftUpdatedAtFormatter().format(date);
}
