import type { DraftEntity } from '../model/shelfLayoutTypes';

export type LayoutEditorEmphasis = 'cells' | 'kinds' | 'machineSelect' | 'assign' | 'save' | null;

export type LayoutEditorFlowGates = {
  multiMode: boolean;
  gridSize: boolean;
  clearSelection: boolean;
  kindButtons: boolean;
  machineSelect: boolean;
  assign: boolean;
  clearCells: boolean;
  save: boolean;
  emphasize: LayoutEditorEmphasis;
};

export function getLayoutEditorFlowGates(input: {
  selectedCount: number;
  pendingKind: DraftEntity['entityKind'] | null;
  selectedMachineCd: string;
  dirty: boolean;
  savePending: boolean;
  /** 棚番パイ選択中はレイアウト用セル操作を抑止 */
  zero2wDeviceSelected?: boolean;
}): LayoutEditorFlowGates {
  if (input.zero2wDeviceSelected) {
    return {
      multiMode: false,
      gridSize: false,
      clearSelection: false,
      kindButtons: false,
      machineSelect: false,
      assign: false,
      clearCells: false,
      save: input.dirty && !input.savePending,
      emphasize: input.dirty ? 'save' : null
    };
  }

  const hasSel = input.selectedCount > 0;
  const hasKind = input.pendingKind != null;
  const machineReady = input.pendingKind !== 'MACHINE' || input.selectedMachineCd.length > 0;
  const canAssign = hasSel && hasKind && machineReady;

  let emphasize: LayoutEditorEmphasis = 'cells';
  if (input.dirty && !hasSel) {
    emphasize = 'save';
  } else if (canAssign) {
    emphasize = 'assign';
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
    assign: canAssign,
    clearCells: hasSel,
    save: input.dirty && !input.savePending,
    emphasize
  };
}
