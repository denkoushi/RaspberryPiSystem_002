/** Presentation helpers for kiosk production schedule progress overview (pure, no React). */

export const PROGRESS_OVERVIEW_CARD_GRID_CLASS =
  'grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-5';

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
