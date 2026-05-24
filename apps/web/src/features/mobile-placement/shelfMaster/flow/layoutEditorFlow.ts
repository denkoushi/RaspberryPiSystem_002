import { hasLayoutEditorFlowInput } from './layoutEditorFlowInput';

import type { DraftEntity } from '../model/shelfLayoutTypes';

export type LayoutEditorEmphasis =
  | 'cells'
  | 'kinds'
  | 'machineSelect'
  | 'zero2wPiSelect'
  | 'assign'
  | 'zero2wPresetApply'
  | 'save'
  | null;

export type LayoutEditorFlowGates = {
  multiMode: boolean;
  gridSize: boolean;
  clearSelection: boolean;
  kindButtons: boolean;
  machineSelect: boolean;
  zero2wPiSelect: boolean;
  assign: boolean;
  zero2wPresetApply: boolean;
  resetFlow: boolean;
  save: boolean;
  emphasize: LayoutEditorEmphasis;
};

export function getLayoutEditorFlowGates(input: {
  selectedCount: number;
  pendingKind: DraftEntity['entityKind'] | null;
  selectedMachineCd: string;
  dirty: boolean;
  savePending: boolean;
  multiMode: boolean;
  piSelectionActive: boolean;
  /** 単一 SHELF マス選択（既存棚） */
  selectionIsExistingShelf: boolean;
  /** 部品置き場の新規割当待ち */
  pendingShelfAssign: boolean;
  zero2wPiSelectionNeedsApply: boolean;
}): LayoutEditorFlowGates {
  const hasSel = input.selectedCount > 0;
  const hasKind = input.pendingKind != null;
  const machineReady = input.pendingKind !== 'MACHINE' || input.selectedMachineCd.length > 0;
  const canAssign = hasSel && hasKind && machineReady;
  const showZero2wPi = input.pendingShelfAssign || input.selectionIsExistingShelf;
  const zero2wPresetApply = input.selectionIsExistingShelf && input.zero2wPiSelectionNeedsApply;

  let emphasize: LayoutEditorEmphasis = 'cells';
  if (input.dirty && !hasSel) {
    emphasize = 'save';
  } else if (zero2wPresetApply) {
    emphasize = 'zero2wPresetApply';
  } else if (canAssign) {
    emphasize = 'assign';
  } else if (showZero2wPi) {
    emphasize = 'zero2wPiSelect';
  } else if (hasSel && input.pendingKind === 'MACHINE' && !machineReady) {
    emphasize = 'machineSelect';
  } else if (hasSel && !hasKind) {
    emphasize = 'kinds';
  } else {
    emphasize = 'cells';
  }

  return {
    multiMode: true,
    gridSize: true,
    clearSelection: hasSel,
    kindButtons: hasSel,
    machineSelect: hasSel && input.pendingKind === 'MACHINE',
    zero2wPiSelect: showZero2wPi,
    assign: canAssign,
    zero2wPresetApply,
    resetFlow: hasLayoutEditorFlowInput({
      selectedCount: input.selectedCount,
      pendingKind: input.pendingKind,
      selectedMachineCd: input.selectedMachineCd,
      multiMode: input.multiMode,
      piSelectionActive: input.piSelectionActive
    }),
    save: input.dirty && !input.savePending,
    emphasize
  };
}
