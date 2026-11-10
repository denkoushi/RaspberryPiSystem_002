export const PLANNING_BOARD_TWO_MACHINE = '021+022';
export const PLANNING_BOARD_TWO_MACHINE_RESOURCES = ['021', '022'] as const;

export function planningBoardResourceMatches(selection: string, resource: string): boolean {
  return selection === PLANNING_BOARD_TWO_MACHINE
    ? PLANNING_BOARD_TWO_MACHINE_RESOURCES.some((candidate) => candidate === resource)
    : selection === resource;
}

export function planningBoardResourceAvailable(selection: string, resources: readonly string[]): boolean {
  return selection === PLANNING_BOARD_TWO_MACHINE
    ? PLANNING_BOARD_TWO_MACHINE_RESOURCES.every((resource) => resources.includes(resource))
    : resources.includes(selection);
}
