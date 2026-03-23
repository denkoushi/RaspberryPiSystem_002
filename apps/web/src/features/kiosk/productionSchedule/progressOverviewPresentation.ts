/** Presentation helpers for kiosk production schedule progress overview (pure, no React). */

export const PROGRESS_OVERVIEW_CARD_GRID_CLASS =
  'grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-5';

/**
 * 行ごとの表示クラス。
 * 納期列と資源CD列の間は、重なりを防ぐため最小限のギャップを常に確保する。
 */
export const PROGRESS_OVERVIEW_PART_ROW_PRODUCT_CELL_CLASS = 'min-w-0 px-0 py-1 pr-1 align-top';

export const PROGRESS_OVERVIEW_PART_ROW_DUE_CELL_CLASS =
  'w-[78px] whitespace-nowrap px-0 py-1 pr-1 align-top font-mono text-[11px] tabular-nums';

export const PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CELL_CLASS = 'min-w-0 px-0 py-1 pl-1 align-top';

export const PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CHIPS_CLASS = 'flex flex-wrap gap-0.5';

export const progressOverviewProcessChipClassName = (isCompleted: boolean): string =>
  [
    'rounded border px-1 py-0.5 text-[10px] leading-none',
    isCompleted
      ? 'border-slate-400 bg-white/10 text-white/70 opacity-50 grayscale'
      : 'border-blue-300 bg-blue-500/30 text-blue-100'
  ].join(' ');

export const formatProgressOverviewUpdatedAt = (value: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ja-JP');
};

export const isProgressOverviewDueDateOverdue = (value: string | null): boolean => {
  if (!value) return false;
  const dueDate = new Date(value);
  if (Number.isNaN(dueDate.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate.getTime() < today.getTime();
};

export const progressOverviewResourceTooltip = (resourceNames?: string[]): string | undefined =>
  resourceNames && resourceNames.length > 0 ? resourceNames.join('\n') : undefined;

export const progressOverviewResourceAriaLabel = (
  resourceCd: string,
  resourceNames?: string[]
): string =>
  resourceNames && resourceNames.length > 0 ? `${resourceCd}: ${resourceNames.join(' / ')}` : resourceCd;
