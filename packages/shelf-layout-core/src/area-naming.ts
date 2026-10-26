/** Shelf areas are named "<machine> <direction>", e.g. "50013_540AP 北". */
export const AREA_DIRECTIONS = ['東', '西', '南', '北'] as const;
export const SHELF_DIRECTIONS = ['北西', '北', '北東', '西', '東', '南西', '南', '南東'] as const;
export type ShelfDirection = (typeof SHELF_DIRECTIONS)[number];
// Area parsing is shared with shelves; inventory choices remain AREA_DIRECTIONS.
export type AreaDirection = ShelfDirection;
export const DEFAULT_AREA_DIRECTION: AreaDirection = '北';

export function composeArea(machine: string, direction: AreaDirection): string {
  return `${machine.trim()} ${direction}`;
}

/** Splits an area into machine and direction; areas named before this rule have no direction. */
export function splitArea(area: string): { machine: string; direction: AreaDirection | null } {
  const trimmed = area.trim();
  const match = /^(.*\S)\s+(北西|北東|南西|南東|東|西|南|北)$/.exec(trimmed);
  if (!match) return { machine: trimmed, direction: null };
  return { machine: match[1], direction: match[2] as AreaDirection };
}
