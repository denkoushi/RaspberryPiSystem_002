export function compareProcessOrder(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a.localeCompare(b);
}

/** True when `candidate` comes after `base`; numerically equal orders such as "010" and "10" are the same process. */
export function isLaterProcessOrder(candidate: string, base: string): boolean {
  const left = Number(candidate);
  const right = Number(base);
  if (candidate.trim() && base.trim() && Number.isFinite(left) && Number.isFinite(right)) return left > right;
  return compareProcessOrder(candidate, base) > 0;
}
