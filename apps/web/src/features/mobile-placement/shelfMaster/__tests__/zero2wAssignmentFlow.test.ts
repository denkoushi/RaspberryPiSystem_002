import { describe, expect, it } from 'vitest';

import { getZero2wAssignmentFlowGates } from '../flow/zero2wAssignmentFlow';

describe('getZero2wAssignmentFlowGates', () => {
  it('emphasizes device when nothing selected', () => {
    const gates = getZero2wAssignmentFlowGates({
      selectedDeviceId: '',
      selectedShelf: '',
      savePending: false,
      layoutCellsSelected: false
    });
    expect(gates.emphasize).toBe('device');
    expect(gates.mapShelfPick).toBe(false);
    expect(gates.save).toBe(false);
  });

  it('enables map shelf pick when device selected and layout cells idle', () => {
    const gates = getZero2wAssignmentFlowGates({
      selectedDeviceId: 'dev-1',
      selectedShelf: '',
      savePending: false,
      layoutCellsSelected: false
    });
    expect(gates.mapShelfPick).toBe(true);
    expect(gates.emphasize).toBe('mapShelf');
    expect(gates.save).toBe(false);
  });

  it('blocks map shelf pick when layout cells are selected', () => {
    const gates = getZero2wAssignmentFlowGates({
      selectedDeviceId: 'dev-1',
      selectedShelf: '',
      savePending: false,
      layoutCellsSelected: true
    });
    expect(gates.mapShelfPick).toBe(false);
    expect(gates.emphasize).toBe('device');
  });

  it('enables save when device and shelf are set', () => {
    const gates = getZero2wAssignmentFlowGates({
      selectedDeviceId: 'dev-1',
      selectedShelf: '東-中央-01',
      savePending: false,
      layoutCellsSelected: false
    });
    expect(gates.save).toBe(true);
    expect(gates.emphasize).toBe('save');
  });

  it('keeps device emphasis when shelf pick is blocked by layout selection', () => {
    const gates = getZero2wAssignmentFlowGates({
      selectedDeviceId: 'dev-1',
      selectedShelf: '東-中央-01',
      savePending: false,
      layoutCellsSelected: true
    });
    expect(gates.save).toBe(true);
    expect(gates.mapShelfPick).toBe(false);
    expect(gates.emphasize).toBe('save');
  });
});
