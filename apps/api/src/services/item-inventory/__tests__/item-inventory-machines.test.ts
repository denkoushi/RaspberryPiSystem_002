import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listMachines, saveMachineOrder } from '../item-inventory-machines.js';
import { resolveTag } from '../item-inventory-operations.js';
import { processTouchTransaction, processTransaction, cancelTransaction } from '../item-inventory-transactions.js';
import { assertNfcUidAvailable } from '../item-inventory.helpers.js';

vi.mock('../../production-schedule/resource-master.service.js', () => ({ getSendaiResourceCds: vi.fn(async () => new Set(['S001'])) }));

function mockDb() {
  const db = {
    clientDevice: { findUnique: vi.fn().mockResolvedValue({ resourceCd: null }) },
    machine: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ resourceCd: null }) },
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
beforeEach(() => { db = mockDb(); });

describe('kiosk inventory machines', () => {
  it('lists only Mishima machines in saved order, appending unsaved machines by name', async () => {
    const machines = ['A', 'B', 'C'].map(id => ({ id, name: id, shortName: null, equipmentManagementNumber: id }));
    db.machine.findMany.mockResolvedValue([...machines, { id: 'sendai', resourceCd: ' s001 ' }]);
    db.kioskInventoryMachineOrder.findMany.mockResolvedValue([{ machineId: 'C' }, { machineId: 'sendai' }, { machineId: 'A' }]);
    expect(await listMachines(db as never, 'd')).toEqual([machines[2], machines[0], machines[1]]);
    expect(db.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }));
    expect(db.kioskInventoryMachineOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientDeviceId: 'd' }, orderBy: { position: 'asc' } }));
  });

  it('lists Mishima machines for a terminal without a site', async () => {
    db.clientDevice.findUnique.mockResolvedValue({ siteKey: null });
    db.machine.findMany.mockResolvedValue([{ id: 'm', name: 'M', shortName: null, equipmentManagementNumber: '1', resourceCd: null }]);
    db.kioskInventoryMachineOrder.findMany.mockResolvedValue([]);
    expect(await listMachines(db as never, 'd')).toEqual([{ id: 'm', name: 'M', shortName: null, equipmentManagementNumber: '1' }]);
    expect(db.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it('replaces the order for this device only and supports clearing it', async () => {
    db.machine.findMany.mockResolvedValue([{ id: 'B' }, { id: 'A' }]);
    await saveMachineOrder(db as never, 'd', ['B', 'A']);
    expect(db.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['B', 'A'] } } }));
    expect(db.kioskInventoryMachineOrder.deleteMany).toHaveBeenCalledWith({ where: { clientDeviceId: 'd' } });
    expect(db.kioskInventoryMachineOrder.createMany).toHaveBeenCalledWith({ data: [{ clientDeviceId: 'd', machineId: 'B', position: 0 }, { clientDeviceId: 'd', machineId: 'A', position: 1 }] });
    db.machine.findMany.mockResolvedValue([]);
    await saveMachineOrder(db as never, 'd', []);
    expect(db.kioskInventoryMachineOrder.createMany).toHaveBeenLastCalledWith({ data: [] });
  });

  it('rejects duplicate and missing order IDs before deleting the order', async () => {
    await expect(saveMachineOrder(db as never, 'd', ['A', 'A'])).rejects.toMatchObject({ statusCode: 400 });
    db.machine.findMany.mockResolvedValue([{ id: 'A' }]);
    await expect(saveMachineOrder(db as never, 'd', ['A', 'outside'])).rejects.toMatchObject({ statusCode: 400 });
    expect(db.kioskInventoryMachineOrder.deleteMany).not.toHaveBeenCalled();
  });

  it('resolves normalized machine UID with the MACHINE discriminator', async () => {
    db.machineNfcTag.findUnique.mockResolvedValue({ machine: { id: 'm', name: '旋盤', shortName: '旋', resourceCd: null } });
    expect(await resolveTag(db as never, ' uid ')).toEqual({ kind: 'MACHINE', machine: { id: 'm', name: '旋盤', shortName: '旋' } });
    expect(db.machineNfcTag.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { uid: 'uid' } }));
    expect(await resolveTag(db as never, 'uid')).toMatchObject({ kind: 'MACHINE' });
  });

  it('hides Sendai machine tags', async () => {
    db.machineNfcTag.findUnique.mockResolvedValue({ machine: { id: 'm', resourceCd: ' s001 ' } });
    expect(await resolveTag(db as never, 'uid')).toBeNull();
  });

  it('rejects Sendai order IDs before deleting the order', async () => {
    db.machine.findMany.mockResolvedValue([{ id: 's', resourceCd: 'S001' }]);
    await expect(saveMachineOrder(db as never, 'd', ['s'])).rejects.toMatchObject({ statusCode: 400 });
    expect(db.kioskInventoryMachineOrder.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps existing tag resolution and missing-tag responses', async () => {
    expect(await resolveTag(db as never, 'missing')).toBeNull();
    db.inventoryNfcTag.findUnique.mockResolvedValue({ id: 'q', uid: 'qty', kind: 'QUANTITY', quantity: 2, compartment: null });
    expect(await resolveTag(db as never, 'qty')).toEqual({ id: 'q', uid: 'qty', kind: 'QUANTITY', quantity: 2, compartment: null });
  });

  it('rejects machine tags when assigning inventory tags', async () => {
    db.machineNfcTag.findUnique.mockResolvedValue({ id: 'mt' });
    await expect(assertNfcUidAvailable('uid', db as never)).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each(['touch', 'nfc'] as const)('saves machineId in %s transactions', async mode => {
    db.inventoryNfcTag.findUnique.mockImplementation(async ({ where }) => where.uid === 'item' ? { kind: 'ITEM', compartmentId: 'c' } : { id: 'q', kind: 'QUANTITY', quantity: 2 });
    const result = mode === 'touch'
      ? await processTouchTransaction(db as never, { compartmentId: 'c', quantity: 2, machineId: 'm', actor: { clientId: 'd' } })
      : await processTransaction(db as never, { itemTagUid: 'item', quantityTagUid: 'q', restock: false, machineId: 'm', actor: { clientId: 'd' } });
    expect(result.transaction).toMatchObject({ machineId: 'm', action: 'ISSUE', delta: -2 });
    expect(db.inventoryTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ machine: { select: { id: true, name: true, shortName: true } } }) }));
  });

  it.each(['touch', 'nfc'] as const)('rejects Sendai machines before %s stock writes', async mode => {
    db.machine.findUnique.mockResolvedValue({ resourceCd: ' s001 ' });
    const result = mode === 'touch'
      ? processTouchTransaction(db as never, { compartmentId: 'c', quantity: 2, machineId: 'm', actor: { clientId: 'd' } })
      : processTransaction(db as never, { itemTagUid: 'item', quantityTagUid: 'q', restock: false, machineId: 'm', actor: { clientId: 'd' } });
    await expect(result).rejects.toMatchObject({ statusCode: 400 });
    expect(db.inventoryCompartment.update).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps transactions without machineId working (restock=%s)', async restock => {
    const result = await processTouchTransaction(db as never, { compartmentId: 'c', quantity: 2, restock, actor: { clientId: 'd' } });
    expect(result.transaction).toMatchObject({ machineId: null, delta: restock ? 2 : -2 });
    expect(db.machine.findUnique).not.toHaveBeenCalled();
    expect(db.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it('copies machineId when cancelling a transaction', async () => {
    const original = { id: 't', machineId: 'm', inventoryItemId: 'i', compartmentId: 'c', clientId: 'd', delta: -2, afterQuantity: 5, action: 'ISSUE' };
    db.inventoryTransaction.findUnique.mockResolvedValue(original);
    db.inventoryTransaction.findFirst.mockResolvedValueOnce(original).mockResolvedValueOnce(null);
    expect(await cancelTransaction(db as never, 't', { clientId: 'd' })).toMatchObject({ machineId: 'm', action: 'CANCEL', delta: 2 });
  });
});
