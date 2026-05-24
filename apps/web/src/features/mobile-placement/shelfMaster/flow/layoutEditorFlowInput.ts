import type { DraftEntity } from '../model/shelfLayoutTypes';

export type LayoutEditorFlowInputState = {
  selectedCount: number;
  pendingKind: DraftEntity['entityKind'] | null;
  selectedMachineCd: string;
  multiMode: boolean;
  piSelectionActive: boolean;
};

/** ポップアップ内の操作フロー入力が残っているか（リセット有効条件） */
export function hasLayoutEditorFlowInput(input: LayoutEditorFlowInputState): boolean {
  return (
    input.selectedCount > 0 ||
    input.pendingKind != null ||
    input.selectedMachineCd.length > 0 ||
    input.multiMode ||
    input.piSelectionActive
  );
}
