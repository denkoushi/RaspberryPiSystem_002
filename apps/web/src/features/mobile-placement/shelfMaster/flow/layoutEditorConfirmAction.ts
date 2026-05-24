import type { LayoutEditorFlowGates } from './layoutEditorFlow';

export type LayoutEditorConfirmAction = 'save' | 'zero2wPresetApply' | 'assign';

/** 統合「確定」ボタンが実行する操作（emphasize 優先順に一致） */
export function resolveLayoutEditorConfirmAction(
  gates: LayoutEditorFlowGates
): LayoutEditorConfirmAction | null {
  if (gates.save && gates.emphasize === 'save') {
    return 'save';
  }
  if (gates.zero2wPresetApply) {
    return 'zero2wPresetApply';
  }
  if (gates.assign) {
    return 'assign';
  }
  return null;
}

export function isLayoutEditorConfirmEnabled(gates: LayoutEditorFlowGates): boolean {
  return resolveLayoutEditorConfirmAction(gates) != null;
}

export function isLayoutEditorConfirmPending(input: {
  action: LayoutEditorConfirmAction | null;
  savePending: boolean;
  zero2wPresetApplyPending: boolean;
}): boolean {
  if (input.action === 'save') {
    return input.savePending;
  }
  if (input.action === 'zero2wPresetApply') {
    return input.zero2wPresetApplyPending;
  }
  return false;
}
