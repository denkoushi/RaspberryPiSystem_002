/**
 * キオスク生産スケジュールの「登録製番」共有履歴（search-state history / activeQueries）の上限。
 * API・Web・可視化データソースで同一値を参照すること。
 */
export const KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX = 50;

/**
 * trim・空除外・先頭優先の重複除去のあと、先頭から最大 {@link KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX} 件に切り詰める。
 */
export function normalizeKioskProductionScheduleSearchHistory(items: string[]): string[] {
  const unique = new Set<string>();
  const next: string[] = [];
  items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => {
      if (unique.has(item)) return;
      unique.add(item);
      next.push(item);
    });
  return next.slice(0, KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX);
}
