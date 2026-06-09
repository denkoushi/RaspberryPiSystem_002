import { listSelfInspectionEntrySlots } from './selfInspectionEntrySlots';

import type { SelfInspectionSessionDetailDto } from './types';

type SessionForNextEntry = Pick<
  SelfInspectionSessionDetailDto,
  'selfInspectionMode' | 'plannedQuantity' | 'expectedEntryCount' | 'requiredEntryCount' | 'entries'
>;

/**
 * 保存後の次入力件を決める。
 * 1. 現在以降の未保存 required slot
 * 2. なければ先頭から未保存 required slot
 * 3. なければ null（全件保存済み）
 */
export function resolveNextRequiredSelfInspectionEntryIndex(
  session: SessionForNextEntry,
  currentEntryIndex: number
): number | null {
  const slots = listSelfInspectionEntrySlots(session);
  if (slots.length === 0) return null;

  const savedIndices = new Set(session.entries.map((entry) => entry.entryIndex));
  const isUnsaved = (entryIndex: number) => !savedIndices.has(entryIndex);

  const currentSlotIndex = slots.findIndex((slot) => slot.entryIndex === currentEntryIndex);
  if (currentSlotIndex >= 0) {
    for (let index = currentSlotIndex + 1; index < slots.length; index += 1) {
      const entryIndex = slots[index]!.entryIndex;
      if (isUnsaved(entryIndex)) return entryIndex;
    }
  }

  for (const slot of slots) {
    if (isUnsaved(slot.entryIndex)) return slot.entryIndex;
  }

  return null;
}
