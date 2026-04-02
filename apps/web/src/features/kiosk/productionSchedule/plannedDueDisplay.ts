/** Display string for planned quantity: null → "-" */
export function formatPlannedQuantityLabel(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return String(value);
}

/**
 * 順位ボード子行インライン用（例: `3個`）。欠損・NaN は非表示にするため null。
 */
export function formatPlannedQuantityInlineJa(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${value}個`;
}

/** CSV着手日 / 完了日の表示（API は ISO 文字列想定） */
export function formatPlannedDateLabel(value: string | null | undefined): string {
  if (value == null || String(value).trim().length === 0) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '-';
  }
}

/** 納期セル表示: 手動 dueDate があれば優先、なければ CSV 完了日 */
export function resolveDisplayDueDate(
  dueDate: string | null | undefined,
  plannedEndDate: string | null | undefined
): string | null {
  const manual = typeof dueDate === 'string' && dueDate.trim().length > 0 ? dueDate.trim() : null;
  if (manual) return manual;
  const csv = typeof plannedEndDate === 'string' && plannedEndDate.trim().length > 0 ? plannedEndDate.trim() : null;
  return csv;
}

/** true = 手動納期あり（強調表示用） */
export function isManualDueDateSet(dueDate: string | null | undefined): boolean {
  return typeof dueDate === 'string' && dueDate.trim().length > 0;
}

const MAX_SORT = 8640000000000000; // stable "nulls last" for ms timestamps

export function displayDueDateSortKey(isoOrNull: string | null): number {
  if (isoOrNull == null || String(isoOrNull).trim().length === 0) return MAX_SORT;
  const t = new Date(isoOrNull).getTime();
  return Number.isNaN(t) ? MAX_SORT : t;
}

/** Ascending: earlier dates first; nulls last */
export function compareDisplayDueDateForSort(a: string | null, b: string | null): number {
  return displayDueDateSortKey(a) - displayDueDateSortKey(b);
}
