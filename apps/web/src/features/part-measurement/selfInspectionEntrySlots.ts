import type { SelfInspectionMode, SelfInspectionSessionDetailDto } from './types';

export type SelfInspectionEntrySlot = {
  entryIndex: number;
  entrySlotKind: 'single' | 'first' | 'last' | 'fixed';
  entrySlotLabel: string;
};

export function listSelfInspectionEntrySlots(
  session: Pick<
    SelfInspectionSessionDetailDto,
    'selfInspectionMode' | 'plannedQuantity' | 'expectedEntryCount' | 'requiredEntryCount'
  >
): SelfInspectionEntrySlot[] {
  const planned = Math.max(1, Math.floor(session.plannedQuantity));
  const mode = session.selfInspectionMode;

  if (mode === 'first_last') {
    if (planned < 2) return [];
    return [
      { entryIndex: 0, entrySlotKind: 'first', entrySlotLabel: '最初' },
      { entryIndex: planned - 1, entrySlotKind: 'last', entrySlotLabel: '最終' }
    ];
  }
  if (mode === 'single') {
    return [{ entryIndex: 0, entrySlotKind: 'single', entrySlotLabel: '1件' }];
  }

  /** 旧形式 full（expected < planned）は API の requiredEntryCount を正とする */
  const count =
    mode === 'full'
      ? Math.max(1, Math.floor(session.requiredEntryCount ?? session.expectedEntryCount))
      : Math.max(1, Math.floor(session.expectedEntryCount));
  return Array.from({ length: count }, (_, i) => ({
    entryIndex: i,
    entrySlotKind: 'fixed' as const,
    entrySlotLabel: String(i + 1)
  }));
}

/** API の required slot 充足と同型: 必須 entryIndex がすべて CONFIRMED で存在するか */
export function areRequiredSelfInspectionSlotsFilled(
  session: Pick<
    SelfInspectionSessionDetailDto,
    'selfInspectionMode' | 'plannedQuantity' | 'expectedEntryCount' | 'requiredEntryCount' | 'entries'
  >
): boolean {
  const required = listSelfInspectionEntrySlots(session);
  if (required.length === 0) return false;
  const present = new Set(
    session.entries
      .filter((entry) => entry.persistenceStatus !== 'draft')
      .map((entry) => entry.entryIndex)
  );
  return required.every((slot) => present.has(slot.entryIndex));
}

export function selfInspectionModeDisplayLabel(mode: SelfInspectionMode, fixedCount: number | null): string {
  switch (mode) {
    case 'single':
      return '抜き取り1個';
    case 'first_last':
      return '最初と最後';
    case 'fixed_count':
      return `指定数 ${fixedCount ?? '—'} 件`;
    case 'full':
    default:
      return '全数';
  }
}
