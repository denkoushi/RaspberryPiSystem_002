/**
 * CONFIRMED 行は「入力を保存」のみ更新する。autosave の draft API は送らない。
 */
export function shouldAutosaveSelfInspectionDraftEntry(
  persistenceStatus: 'draft' | 'confirmed' | null | undefined
): boolean {
  return persistenceStatus !== 'confirmed';
}
