export function isPlanningBoardUnitSplitEnabled(resourceCd: string, flags?: Readonly<Record<string, boolean>>): boolean {
  const stored = flags && Object.hasOwn(flags, resourceCd) ? flags[resourceCd] : undefined;
  return typeof stored === 'boolean' ? stored : resourceCd === '021' || resourceCd === '022';
}
