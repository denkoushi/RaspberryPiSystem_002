import { describe, expect, it } from 'vitest';

import { getLayoutEditorFlowGates } from '../flow/layoutEditorFlow';

describe('getLayoutEditorFlowGates', () => {
  it('disables assign until kind is chosen', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 1,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false
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
      savePending: false
    });
    expect(gates.assign).toBe(true);
    expect(gates.emphasize).toBe('assign');
  });

  it('blocks layout controls when zero2w device is selected', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 0,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: false,
      savePending: false,
      zero2wDeviceSelected: true
    });
    expect(gates.kindButtons).toBe(false);
    expect(gates.assign).toBe(false);
    expect(gates.multiMode).toBe(false);
  });

  it('emphasizes save when dirty and no selection', () => {
    const gates = getLayoutEditorFlowGates({
      selectedCount: 0,
      pendingKind: null,
      selectedMachineCd: '',
      dirty: true,
      savePending: false
    });
    expect(gates.save).toBe(true);
    expect(gates.emphasize).toBe('save');
  });
});
