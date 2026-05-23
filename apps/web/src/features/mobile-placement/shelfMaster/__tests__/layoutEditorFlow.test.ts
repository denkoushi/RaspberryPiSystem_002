import { describe, expect, it } from 'vitest';

import { getLayoutEditorFlowGates } from '../flow/layoutEditorFlow';

describe('getLayoutEditorFlowGates', () => {
  it('disables assign until kind is chosen', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: false
    });
    expect(gates.kindButtons).toBe(true);
    expect(gates.assign).toBe(false);
    expect(gates.emphasize).toBe('kinds');
  });

  it('enables assign when kind and selection ready', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: 'AISLE',
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: false
    });
    expect(gates.assign).toBe(true);
    expect(gates.emphasize).toBe('assign');
  });

  it('shows zero2w pi select for pending shelf assign', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: 'SHELF',
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: true,
      zero2wPiSelectionNeedsApply: false
    });
    expect(gates.zero2wPiSelect).toBe(true);
    expect(gates.zero2wPresetApply).toBe(false);
    expect(gates.assign).toBe(true);
    expect(gates.emphasize).toBe('assign');
  });

  it('shows preset apply for existing shelf with pi change', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      selectionIsExistingShelf: true,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: true
    });
    expect(gates.zero2wPresetApply).toBe(true);
    expect(gates.emphasize).toBe('zero2wPresetApply');
  });

  it('emphasizes save when dirty and no selection', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 0,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: true,
      savePending: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: false
    });
    expect(gates.save).toBe(true);
    expect(gates.emphasize).toBe('save');
  });
});
