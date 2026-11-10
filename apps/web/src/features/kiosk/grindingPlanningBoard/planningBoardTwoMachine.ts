export const PLANNING_BOARD_TWO_MACHINE = '021+022';

export function planningBoardPair(selection?: string | null): [string, string] | null {
  const parts = selection?.split('+');
  return parts?.length === 2 && parts[0] && parts[1] && parts[0] !== parts[1] ? [parts[0], parts[1]] : null;
}

export function planningBoardResourceMatches(selection: string, resource: string): boolean {
  return planningBoardPair(selection)?.includes(resource) ?? selection === resource;
}

export function planningBoardResourceAvailable(selection: string, resources: readonly string[]): boolean {
  return planningBoardPair(selection)?.every((resource) => resources.includes(resource)) ?? resources.includes(selection);
}
