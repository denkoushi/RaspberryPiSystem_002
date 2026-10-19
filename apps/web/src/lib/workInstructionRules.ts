/**
 * Normalizes the value read from an FHINCD barcode before it crosses the API
 * boundary. The backend uses the same NFKC/trim/uppercase part-number key.
 */
export function normalizeWorkInstructionPartNumber(rawText: string | null | undefined): string {
  if (rawText === null || rawText === undefined) return '';
  return rawText.normalize('NFKC').trim().toUpperCase();
}

const TARGET_PRIORITY: ReadonlyMap<string, number> = new Map([
  ['研削', 0],
  ['切削', 1]
]);

function compareWorkInstructionTargets(left: string, right: string): number {
  const leftPriority = TARGET_PRIORITY.get(left);
  const rightPriority = TARGET_PRIORITY.get(right);

  if (leftPriority !== undefined || rightPriority !== undefined) {
    if (leftPriority === undefined) return 1;
    if (rightPriority === undefined) return -1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  }

  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

/** Deduplicates and presents shooting targets in the kiosk chip order. */
export function dedupeAndSortWorkInstructionTargets(
  targets: ReadonlyArray<string>
): string[] {
  return [...new Set(targets)].sort(compareWorkInstructionTargets);
}
