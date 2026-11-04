import { normalizeMachineName } from '../productionSchedule/machineName';

import type { InventoryMachine } from '../../../api/client';

export function inventoryMachineLabel(machine: Pick<InventoryMachine, 'id' | 'name' | 'shortName'>, machines: InventoryMachine[]): { name: string; number?: string } {
  const short = normalizeMachineName(machine.shortName || machine.name);
  if (!machines.some(other => other.id !== machine.id && normalizeMachineName(other.shortName || other.name) === short)) return { name: short };
  const full = normalizeMachineName(machine.name);
  if (!machines.some(other => other.id !== machine.id && normalizeMachineName(other.name) === full)) return { name: full };
  return { name: short, number: machines.find(other => other.id === machine.id)?.equipmentManagementNumber };
}
