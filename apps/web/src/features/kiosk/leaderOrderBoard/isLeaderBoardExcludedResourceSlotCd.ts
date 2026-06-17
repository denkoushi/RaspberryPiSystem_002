/** 順位ボードの資源 slot として表示しない FSIGENCD（人工数行）。 */
export const LEADER_BOARD_EXCLUDED_RESOURCE_SLOT_CDS = ['10'] as const;

export function isLeaderBoardExcludedResourceSlotCd(resourceCd: string | null | undefined): boolean {
  const normalized = String(resourceCd ?? '').trim().toUpperCase();
  if (!normalized.length) return false;
  return (LEADER_BOARD_EXCLUDED_RESOURCE_SLOT_CDS as readonly string[]).includes(normalized);
}

export function filterLeaderBoardSlotResourceCds(resourceCds: readonly string[]): string[] {
  return resourceCds.filter((cd) => !isLeaderBoardExcludedResourceSlotCd(cd));
}
