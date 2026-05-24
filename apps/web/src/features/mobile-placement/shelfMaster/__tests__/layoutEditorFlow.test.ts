import { describe, expect, it } from 'vitest';

import {
  isLayoutEditorConfirmPending,
  resolveLayoutEditorConfirmAction
} from '../flow/layoutEditorConfirmAction';
import { getLayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import { hasLayoutEditorFlowInput } from '../flow/layoutEditorFlowInput';

describe('getLayoutEditorFlowGates', () => {
  it('disables assign until kind is chosen', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      multiMode: false,
      piSelectionActive: false,
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
      multiMode: false,
      piSelectionActive: false,
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
      multiMode: false,
      piSelectionActive: false,
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
      multiMode: false,
      piSelectionActive: true,
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
      multiMode: false,
      piSelectionActive: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: false
    });
    expect(gates.save).toBe(true);
    expect(gates.emphasize).toBe('save');
  });

  it('enables resetFlow when multiMode is on without selection', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 0,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      multiMode: true,
      piSelectionActive: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: false
    });
    expect(gates.resetFlow).toBe(true);
  });

  it('disables resetFlow when no flow input remains', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 0,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      multiMode: false,
      piSelectionActive: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: false
    });
    expect(gates.resetFlow).toBe(false);
  });
});

describe('hasLayoutEditorFlowInput', () => {
  it('is true when pending kind remains after deselecting cells', () => {
    expect(
      hasLayoutEditorFlowInput({
        selectedCount: 0,
        pendingKind: 'SHELF',
        selectedMachineCd: '',
        multiMode: false,
        piSelectionActive: false
      })
    ).toBe(true);
  });
});

describe('resolveLayoutEditorConfirmAction', () => {
  it('prioritizes save over assign', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: 'AISLE',
      selectedMachineCd: '',
      dirty: true,
      savePending: false,
      multiMode: false,
      piSelectionActive: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: false
    });
    expect(gates.emphasize).toBe('assign');
    const gatesSave = getLayoutEditorFlowGates({
      selectedCount: 0,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: true,
      savePending: false,
      multiMode: false,
      piSelectionActive: false,
      selectionIsExistingShelf: false,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: false
    });
    expect(resolveLayoutEditorConfirmAction(gatesSave)).toBe('save');
  });

  it('returns zero2wPresetApply before assign', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      multiMode: false,
      piSelectionActive: true,
      selectionIsExistingShelf: true,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: true
    });
    expect(resolveLayoutEditorConfirmAction(gates)).toBe('zero2wPresetApply');
  });

  it('marks confirm pending while zero2w preset apply is in flight', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      multiMode: false,
      piSelectionActive: true,
      selectionIsExistingShelf: true,
      pendingShelfAssign: false,
      zero2wPiSelectionNeedsApply: true
    });
    expect(
      isLayoutEditorConfirmPending({
        action: resolveLayoutEditorConfirmAction(gates),
        savePending: false,
        zero2wPresetApplyPending: true
      })
    ).toBe(true);
  });
});
