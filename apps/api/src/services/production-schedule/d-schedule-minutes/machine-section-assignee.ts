export function isMachineSectionAssigned(assignees: readonly string[]): boolean {
  return assignees.some((value) => value.normalize('NFKC').includes('機械課'));
}
