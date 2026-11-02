import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { runSerializable } from './item-inventory.helpers.js';

const machineSelect = { id: true, name: true, shortName: true, equipmentManagementNumber: true } as const;

export async function listMachines(db: PrismaClient, clientDeviceId: string) {
  const device = await db.clientDevice.findUnique({ where: { id: clientDeviceId }, select: { siteKey: true } });
  if (!device?.siteKey) return [];
  const [machines, orders] = await Promise.all([
    db.machine.findMany({ where: { siteKey: device.siteKey }, select: machineSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    db.kioskInventoryMachineOrder.findMany({ where: { clientDeviceId }, orderBy: { position: 'asc' }, select: { machineId: true } }),
  ]);
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
    const device = await tx.clientDevice.findUnique({ where: { id: clientDeviceId }, select: { siteKey: true } });
    const machines = device?.siteKey ? await tx.machine.findMany({ where: { id: { in: machineIds }, siteKey: device.siteKey }, select: { id: true } }) : [];
    if (machines.length !== machineIds.length) throw new ApiError(400, '端末の拠点外の加工機は指定できません');
    await tx.kioskInventoryMachineOrder.deleteMany({ where: { clientDeviceId } });
    await tx.kioskInventoryMachineOrder.createMany({ data: machineIds.map((machineId, position) => ({ clientDeviceId, machineId, position })) });
  });
}

export async function assertMachineForClient(db: Prisma.TransactionClient, machineId: string, clientId?: string | null) {
  const machine = await db.machine.findUnique({ where: { id: machineId }, select: { siteKey: true } });
  if (!machine) throw new ApiError(400, '加工機が見つかりません');
  if (clientId) {
    const device = await db.clientDevice.findUnique({ where: { id: clientId }, select: { siteKey: true } });
    if (!device?.siteKey || machine.siteKey !== device.siteKey) throw new ApiError(400, '端末の拠点外の加工機は指定できません');
  }
}
