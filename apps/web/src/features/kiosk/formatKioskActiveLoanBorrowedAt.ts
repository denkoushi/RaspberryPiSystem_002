const FALLBACK = '—';

let borrowedAtFormatter: Intl.DateTimeFormat | null = null;

function getBorrowedAtFormatter(): Intl.DateTimeFormat {
  if (!borrowedAtFormatter) {
    borrowedAtFormatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return borrowedAtFormatter;
}

/**
 * キオスク持出一覧カードの貸出日時表示用。
 * - 秒なし（分まで）
 * - 24時間表記（hour12: false）
 * - 現場表示の揃え用に Asia/Tokyo 固定
 */
export function formatKioskActiveLoanBorrowedAt(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return FALLBACK;
  }
  return getBorrowedAtFormatter().format(date);
}
