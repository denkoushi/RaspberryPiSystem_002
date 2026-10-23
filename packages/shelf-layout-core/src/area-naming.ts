/** Shelf areas are named "<machine> <direction>", e.g. "50013_540AP 北". */
export const AREA_DIRECTIONS = ['東', '西', '南', '北'] as const;
export type AreaDirection = (typeof AREA_DIRECTIONS)[number];
export const DEFAULT_AREA_DIRECTION: AreaDirection = '北';

export function composeArea(machine: string, direction: AreaDirection): string {
  return `${machine.trim()} ${direction}`;
}

/** Splits an area into machine and direction; areas named before this rule have no direction. */
export function splitArea(area: string): { machine: string; direction: AreaDirection | null } {
  const trimmed = area.trim();
  const match = /^(.*\S)\s+([東西南北])$/.exec(trimmed);
  if (!match) return { machine: trimmed, direction: null };
  return { machine: match[1], direction: match[2] as AreaDirection };
}
