import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemInventoryService } from '../item-inventory.service.js';
import { assertNfcUidAvailable } from '../item-inventory.helpers.js';

function mockDb() {
  const db = {
    clientDevice: { findUnique: vi.fn().mockResolvedValue({ siteKey: 'a' }) },
    machine: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ siteKey: 'a' }) },
    machineNfcTag: { findUnique: vi.fn().mockResolvedValue(null) },
    kioskInventoryMachineOrder: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    employee: { findFirst: vi.fn().mockResolvedValue(null) },
    item: { findFirst: vi.fn().mockResolvedValue(null) },
    measuringInstrumentTag: { findFirst: vi.fn().mockResolvedValue(null) },
    riggingGearTag: { findFirst: vi.fn().mockResolvedValue(null) },
    inventoryNfcTag: { findUnique: vi.fn().mockResolvedValue(null) },
    inventoryCompartment: { findUnique: vi.fn().mockResolvedValue({ id: 'c', inventoryItemId: 'i', stockQuantity: 5 }), update: vi.fn().mockResolvedValue({ stockQuantity: 3 }) },
    inventoryTransaction: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(async ({ data }) => data) },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async work => work(db));
  return db;
}

let db: ReturnType<typeof mockDb>;
let service: ItemInventoryService;
beforeEach(() => { db = mockDb(); service = new ItemInventoryService(db as never); });

describe('kiosk inventory machines', () => {
  it('lists only site machines in saved order, appending unsaved machines by name', async () => {
    const machines = ['A', 'B', 'C'].map(id => ({ id, name: id, shortName: null, equipmentManagementNumber: id }));
    db.machine.findMany.mockResolvedValue(machines);
    db.kioskInventoryMachineOrder.findMany.mockResolvedValue([{ machineId: 'C' }, { machineId: 'other-site' }, { machineId: 'A' }]);
    expect(await service.listMachines('d')).toEqual([machines[2], machines[0], machines[1]]);
    expect(db.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siteKey: 'a' }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }));
    expect(db.kioskInventoryMachineOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientDeviceId: 'd' }, orderBy: { position: 'asc' } }));
  });

  it('returns no machines for a terminal without a site', async () => {
    db.clientDevice.findUnique.mockResolvedValue({ siteKey: null });
    expect(await service.listMachines('d')).toEqual([]);
    expect(db.machine.findMany).not.toHaveBeenCalled();
  });

  it('replaces the order for this device only and supports clearing it', async () => {
    db.machine.findMany.mockResolvedValue([{ id: 'B' }, { id: 'A' }]);
    await service.saveMachineOrder('d', ['B', 'A']);
    expect(db.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['B', 'A'] }, siteKey: 'a' } }));
    expect(db.kioskInventoryMachineOrder.deleteMany).toHaveBeenCalledWith({ where: { clientDeviceId: 'd' } });
    expect(db.kioskInventoryMachineOrder.createMany).toHaveBeenCalledWith({ data: [{ clientDeviceId: 'd', machineId: 'B', position: 0 }, { clientDeviceId: 'd', machineId: 'A', position: 1 }] });
    db.machine.findMany.mockResolvedValue([]);
    await service.saveMachineOrder('d', []);
    expect(db.kioskInventoryMachineOrder.createMany).toHaveBeenLastCalledWith({ data: [] });
  });

  it('rejects duplicate and outside-site order IDs before deleting the order', async () => {
    await expect(service.saveMachineOrder('d', ['A', 'A'])).rejects.toMatchObject({ statusCode: 400 });
    db.machine.findMany.mockResolvedValue([{ id: 'A' }]);
    await expect(service.saveMachineOrder('d', ['A', 'outside'])).rejects.toMatchObject({ statusCode: 400 });
    expect(db.kioskInventoryMachineOrder.deleteMany).not.toHaveBeenCalled();
  });

  it('resolves normalized machine UID with the MACHINE discriminator', async () => {
    db.machineNfcTag.findUnique.mockResolvedValue({ machine: { id: 'm', name: '旋盤', shortName: '旋', siteKey: 'a' } });
    expect(await service.resolveTag(' uid ', 'd')).toEqual({ kind: 'MACHINE', machine: { id: 'm', name: '旋盤', shortName: '旋' } });
    expect(db.machineNfcTag.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { uid: 'uid' } }));
    expect(await service.resolveTag('uid')).toMatchObject({ kind: 'MACHINE' });
  });

  it.each(['b', null])('hides another-site machine from site %s', async siteKey => {
    db.clientDevice.findUnique.mockResolvedValue({ siteKey });
    db.machineNfcTag.findUnique.mockResolvedValue({ machine: { id: 'm', siteKey: 'a' } });
    expect(await service.resolveTag('uid', 'd')).toBeNull();
  });

  it('keeps existing tag resolution and missing-tag responses', async () => {
    expect(await service.resolveTag('missing', 'd')).toBeNull();
    db.inventoryNfcTag.findUnique.mockResolvedValue({ id: 'q', uid: 'qty', kind: 'QUANTITY', quantity: 2, compartment: null });
    expect(await service.resolveTag('qty', 'd')).toEqual({ id: 'q', uid: 'qty', kind: 'QUANTITY', quantity: 2, compartment: null });
  });

  it('rejects machine tags when assigning inventory tags', async () => {
    db.machineNfcTag.findUnique.mockResolvedValue({ id: 'mt' });
    await expect(assertNfcUidAvailable('uid', db as never)).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each(['touch', 'nfc'] as const)('saves machineId in %s transactions', async mode => {
    db.inventoryNfcTag.findUnique.mockImplementation(async ({ where }) => where.uid === 'item' ? { kind: 'ITEM', compartmentId: 'c' } : { id: 'q', kind: 'QUANTITY', quantity: 2 });
    const result = mode === 'touch'
      ? await service.processTouchTransaction({ compartmentId: 'c', quantity: 2, machineId: 'm', actor: { clientId: 'd' } })
      : await service.processTransaction({ itemTagUid: 'item', quantityTagUid: 'q', restock: false, machineId: 'm', actor: { clientId: 'd' } });
    expect(result.transaction).toMatchObject({ machineId: 'm', action: 'ISSUE', delta: -2 });
    expect(db.inventoryTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ machine: { select: { id: true, name: true, shortName: true } } }) }));
  });

  it.each(['touch', 'nfc'] as const)('rejects outside-site machines before %s stock writes', async mode => {
    db.machine.findUnique.mockResolvedValue({ siteKey: 'b' });
    const result = mode === 'touch'
      ? service.processTouchTransaction({ compartmentId: 'c', quantity: 2, machineId: 'm', actor: { clientId: 'd' } })
      : service.processTransaction({ itemTagUid: 'item', quantityTagUid: 'q', restock: false, machineId: 'm', actor: { clientId: 'd' } });
    await expect(result).rejects.toMatchObject({ statusCode: 400 });
    expect(db.inventoryCompartment.update).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps transactions without machineId working (restock=%s)', async restock => {
    const result = await service.processTouchTransaction({ compartmentId: 'c', quantity: 2, restock, actor: { clientId: 'd' } });
    expect(result.transaction).toMatchObject({ machineId: null, delta: restock ? 2 : -2 });
    expect(db.machine.findUnique).not.toHaveBeenCalled();
    expect(db.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it('copies machineId when cancelling a transaction', async () => {
    const original = { id: 't', machineId: 'm', inventoryItemId: 'i', compartmentId: 'c', clientId: 'd', delta: -2, afterQuantity: 5, action: 'ISSUE' };
    db.inventoryTransaction.findUnique.mockResolvedValue(original);
    db.inventoryTransaction.findFirst.mockResolvedValueOnce(original).mockResolvedValueOnce(null);
    expect(await service.cancelTransaction('t', { clientId: 'd' })).toMatchObject({ machineId: 'm', action: 'CANCEL', delta: 2 });
  });
});
