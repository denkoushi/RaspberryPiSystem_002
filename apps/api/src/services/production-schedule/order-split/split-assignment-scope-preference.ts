/** split / 親 assignment の location scope 解決（exact location を site fallback より優先）。 */
export function compareScopedLocationAssignments(
  a: { location: string; updatedAt: Date },
  b: { location: string; updatedAt: Date },
  locationKey: string
): number {
  const aRank = a.location === locationKey ? 0 : 1;
  const bRank = b.location === locationKey ? 0 : 1;
  if (aRank !== bRank) return aRank - bRank;
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

export function pickPreferredScopedLocationAssignment<T extends { location: string; updatedAt: Date }>(
  assignments: readonly T[],
  locationKey: string
): T | undefined {
  if (assignments.length === 0) return undefined;
  return [...assignments].sort((a, b) => compareScopedLocationAssignments(a, b, locationKey))[0];
}

export function buildSplitAssignmentScopeInclude(locationKey: string): {
  where: {
    OR: Array<{ location: string } | { siteKey: string }>;
  };
} {
  return {
    where: {
      OR: [{ location: locationKey }, { siteKey: locationKey }]
    }
  };
}
