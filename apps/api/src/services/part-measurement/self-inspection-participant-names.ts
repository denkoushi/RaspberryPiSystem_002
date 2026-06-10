export type SelfInspectionParticipantEntryRow = {
  entryIndex: number;
  createdByEmployeeNameSnapshot: string | null;
};

/**
 * セッション内 entry から測定者氏名を entryIndex 昇順・重複除去で集約する。
 */
export function collectParticipantEmployeeNames(
  entries: readonly SelfInspectionParticipantEntryRow[] | null | undefined
): string[] {
  if (!entries?.length) {
    return [];
  }
  const sorted = [...entries].sort((a, b) => a.entryIndex - b.entryIndex);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of sorted) {
    const name = (entry.createdByEmployeeNameSnapshot ?? '').trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}
