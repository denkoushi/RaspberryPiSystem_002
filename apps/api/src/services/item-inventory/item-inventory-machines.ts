import { resolveMachineFactory } from '../tools/machine-factory.js';
import { getSendaiResourceCds } from '../production-schedule/resource-master.service.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { runSerializable } from './item-inventory.helpers.js';

const machineSelect = { id: true, name: true, shortName: true, equipmentManagementNumber: true } as const;

export async function listMachines(db: PrismaClient, clientDeviceId: string) {
  const [allMachines, orders, sendaiResourceCds] = await Promise.all([
    db.machine.findMany({ select: { ...machineSelect, resourceCd: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    db.kioskInventoryMachineOrder.findMany({ where: { clientDeviceId }, orderBy: { position: 'asc' }, select: { machineId: true } }),
    getSendaiResourceCds(),
  ]);
  const machines = allMachines.filter(machine => resolveMachineFactory(machine.resourceCd, sendaiResourceCds) === 'MISHIMA')
    .map(machine => ({ id: machine.id, name: machine.name, shortName: machine.shortName, equipmentManagementNumber: machine.equipmentManagementNumber }));
  const byId = new Map(machines.map(machine => [machine.id, machine]));
  const saved = orders.flatMap(order => {
    const machine = byId.get(order.machineId);
    byId.delete(order.machineId);
    return machine ? [machine] : [];
  });
  return [...saved, ...byId.values()];
}

export async function saveMachineOrder(db: PrismaClient, clientDeviceId: string, machineIds: string[]) {
  if (new Set(machineIds).size !== machineIds.length) throw new ApiError(400, '加工機IDが重複しています');
  await runSerializable(db, async tx => {
    const machines = await tx.machine.findMany({ where: { id: { in: machineIds } }, select: { id: true, resourceCd: true } });
    const sendaiResourceCds = await getSendaiResourceCds();
    if (machines.length !== machineIds.length || machines.some(machine => resolveMachineFactory(machine.resourceCd, sendaiResourceCds) !== 'MISHIMA')) {
      throw new ApiError(400, '三島工場以外の加工機は指定できません');
    }
    await tx.kioskInventoryMachineOrder.deleteMany({ where: { clientDeviceId } });
    await tx.kioskInventoryMachineOrder.createMany({ data: machineIds.map((machineId, position) => ({ clientDeviceId, machineId, position })) });
  });
}

export async function assertMishimaMachine(db: Prisma.TransactionClient, machineId: string) {
  const machine = await db.machine.findUnique({ where: { id: machineId }, select: { resourceCd: true } });
  if (!machine) throw new ApiError(400, '加工機が見つかりません');
  if (resolveMachineFactory(machine.resourceCd, await getSendaiResourceCds()) !== 'MISHIMA') {
    throw new ApiError(400, '三島工場以外の加工機は指定できません');
  }
}
