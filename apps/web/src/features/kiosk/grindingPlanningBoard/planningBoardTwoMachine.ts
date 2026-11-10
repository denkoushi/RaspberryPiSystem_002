export const PLANNING_BOARD_TWO_MACHINE = '021+022';

export function planningBoardPair(selection?: string | null, resources?: readonly string[]): [string, string] | null {
  if (selection && resources?.includes(selection)) return null;
  const parts = selection?.split('+');
  return parts?.length === 2 && parts[0] && parts[1] && parts[0] !== parts[1] && (!resources || parts.every(part => resources.includes(part))) ? [parts[0], parts[1]] : null;
}

export function planningBoardResourceMatches(selection: string, resource: string, resources?: readonly string[]): boolean {
  return planningBoardPair(selection, resources)?.includes(resource) ?? selection === resource;
}

export function planningBoardResourceAvailable(selection: string, resources: readonly string[]): boolean {
  return planningBoardPair(selection, resources)?.every((resource) => resources.includes(resource)) ?? resources.includes(selection);
}
