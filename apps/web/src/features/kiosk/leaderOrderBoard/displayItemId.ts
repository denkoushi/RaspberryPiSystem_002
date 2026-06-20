const SPLIT_PREFIX = 'split:';

export function isSplitDisplayItemId(displayItemId: string): boolean {
  return displayItemId.trim().startsWith(SPLIT_PREFIX);
}

export function resolveSplitIdFromDisplayItemId(displayItemId: string): string | null {
  const trimmed = displayItemId.trim();
  if (!trimmed.startsWith(SPLIT_PREFIX)) return null;
  const splitId = trimmed.slice(SPLIT_PREFIX.length).trim();
  return splitId.length > 0 ? splitId : null;
}

export function resolveSourceRowIdFromLeaderBoardRow(row: {
  id: string;
  sourceRowId?: string;
}): string {
  return row.sourceRowId?.trim() || row.id.trim();
}

export const KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED =
  import.meta.env.VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED === 'true';
