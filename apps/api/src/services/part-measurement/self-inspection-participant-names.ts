export type SelfInspectionParticipantEntryRow = {
  entryIndex: number;
  createdByEmployeeId?: string | null;
  createdByEmployeeNameSnapshot: string | null;
};

export type SelfInspectionParticipantEmployee = {
  employeeId: string;
  displayName: string;
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

/**
 * セッション内 entry から NFC 検索に使う測定者 ID・氏名を entryIndex 昇順・ID 重複除去で集約する。
 * 氏名だけの互換表示とは分離し、削除済み従業員など ID がない履歴は検索対象に含めない。
 */
export function collectParticipantEmployees(
  entries: readonly SelfInspectionParticipantEntryRow[] | null | undefined
): SelfInspectionParticipantEmployee[] {
  if (!entries?.length) {
    return [];
  }
  const sorted = [...entries].sort((a, b) => a.entryIndex - b.entryIndex);
  const seen = new Set<string>();
  const employees: SelfInspectionParticipantEmployee[] = [];
  for (const entry of sorted) {
    const employeeId = (entry.createdByEmployeeId ?? '').trim();
    const displayName = (entry.createdByEmployeeNameSnapshot ?? '').trim();
    if (!employeeId || !displayName || seen.has(employeeId)) {
      continue;
    }
    seen.add(employeeId);
    employees.push({ employeeId, displayName });
  }
  return employees;
}
