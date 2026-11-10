import { describe, expect, it } from 'vitest';

import { inventoryMachineLabel } from './inventoryMachineLabel';

const machine = { id: 'a', name: '正式Ａ', shortName: 'ＭＣ', equipmentManagementNumber: '123' };
describe('inventoryMachineLabel', () => {
  it('uses the normalized unique short name, falling back to the name if absent', () => {
    expect(inventoryMachineLabel(machine, [machine])).toEqual({ name: 'MC' });
    expect(inventoryMachineLabel({ ...machine, shortName: null }, [machine])).toEqual({ name: '正式A' });
  });
  it('uses the full name when normalized short names collide', () => {
    expect(inventoryMachineLabel(machine, [machine, { ...machine, id: 'b', name: '正式B', shortName: 'mc' }])).toEqual({ name: '正式A' });
  });
  it('uses short name and management number when normalized full names also collide', () => {
    expect(inventoryMachineLabel(machine, [machine, { ...machine, id: 'b', name: '正式A', shortName: 'mc', equipmentManagementNumber: '456' }])).toEqual({ name: 'MC', number: '123' });
  });
});
