import Fastify, { type InjectOptions } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    inventoryMachineOptionalDepartment: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    productionScheduleResourceMaster: { findMany: vi.fn() },
    clientDevice: { findUnique: vi.fn() },
    machine: { findMany: vi.fn(), findUnique: vi.fn() },
    machineNfcTag: { findUnique: vi.fn() },
    inventoryNfcTag: { findUnique: vi.fn() },
    kioskInventoryMachineOrder: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    inventoryCompartment: { findUnique: vi.fn(), update: vi.fn() },
    inventoryTransaction: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({ SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared', verifyDueManagementAccessPassword: vi.fn(async ({ password }) => ({ success: password === '2520' })) }));
vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../services/item-inventory/item-inventory-service.factory.js', async () => {
  const { ItemInventoryService } = await import('../../services/item-inventory/item-inventory.service.js');
  return { getItemInventoryServices: () => ({ inventory: new ItemInventoryService(db as never) }) };
});

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { registerItemInventoryRoutes } from './index.js';

const machineId = 'a0000000-0000-4000-8000-000000000001';
const compartmentId = 'c0000000-0000-4000-8000-000000000001';
const machine = { id: machineId, name: '旋盤', shortName: '旋', equipmentManagementNumber: '001', resourceCd: null };
async function request(options: InjectOptions) {
  const app = Fastify();
  registerErrorHandler(app);
  registerItemInventoryRoutes(app);
  try { return await app.inject({ headers: { 'x-client-key': 'key' }, ...options }); }
  finally { await app.close(); }
}

beforeEach(() => {
  vi.resetAllMocks();
  db.clientDevice.findUnique.mockImplementation(async ({ where }) => where.apiKey === 'key' || where.id === 'd' ? { id: 'd', siteKey: 'a' } : null);
  db.productionScheduleResourceMaster.findMany.mockResolvedValue([{ resourceCd: 'S001', resourceGroupCd: 'S-1' }]);
  db.machine.findUnique.mockResolvedValue(machine);
  db.machine.findMany.mockResolvedValue([machine]);
  db.kioskInventoryMachineOrder.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async work => work(db));
  db.inventoryCompartment.findUnique.mockResolvedValue({ id: compartmentId, inventoryItemId: 'i', stockQuantity: 5 });
  db.inventoryCompartment.update.mockResolvedValue({ stockQuantity: 4 });
  db.inventoryTransaction.create.mockImplementation(async ({ data }) => ({ id: 't', ...data }));
});

describe('inventory machine API', () => {
  it.each(['GET', 'PUT'] as const)('requires client authentication for %s machines', async method => {
    const response = await request({ method, url: '/item-inventory/machines' + (method === 'PUT' ? '/order' : ''), headers: {}, ...(method === 'PUT' ? { payload: { machineIds: [] } } : {}) });
    expect(response.statusCode).toBe(401);
    expect(db.machine.findMany).not.toHaveBeenCalled();
  });

  it('lists machines and saves the terminal order without a settings password', async () => {
    db.clientDevice.findUnique.mockResolvedValue({ id: 'd', siteKey: null });
    db.machine.findMany.mockResolvedValue([machine, { ...machine, id: 'sendai', resourceCd: 'S001' }]);
    const listed = await request({ method: 'GET', url: '/item-inventory/machines' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().machines).toMatchObject([{ id: machineId }]);
    expect(listed.json().machines).toHaveLength(1);
    db.machine.findMany.mockResolvedValue([machine]);
    const saved = await request({ method: 'PUT', url: '/item-inventory/machines/order', payload: { machineIds: [machineId] } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ success: true });
  });

  it('returns 400 for Sendai order IDs', async () => {
    db.machine.findMany.mockResolvedValue([{ ...machine, resourceCd: 'S001' }]);
    expect((await request({ method: 'PUT', url: '/item-inventory/machines/order', payload: { machineIds: [machineId] } })).statusCode).toBe(400);
  });

  it('resolves MACHINE and hides Sendai machines', async () => {
    db.machineNfcTag.findUnique.mockResolvedValue({ machine });
    const resolved = await request({ method: 'GET', url: '/item-inventory/tags/resolve?uid=ABCD' });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toEqual({ tag: { kind: 'MACHINE', machine: { id: machineId, name: '旋盤', shortName: '旋' } } });
    db.machineNfcTag.findUnique.mockResolvedValue({ machine: { ...machine, resourceCd: ' s001 ' } });
    expect((await request({ method: 'GET', url: '/item-inventory/tags/resolve?uid=ABCD' })).json()).toEqual({ tag: null });
  });

  it.each(['transactions', 'touch-transactions'])('accepts optional machineId and rejects Sendai for %s', async path => {
    db.inventoryNfcTag.findUnique.mockImplementation(async ({ where }) => where.uid === 'item' ? { kind: 'ITEM', compartmentId } : { id: 'q', kind: 'QUANTITY', quantity: 1 });
    const payload = path === 'transactions' ? { itemTagUid: 'item', quantityTagUid: 'q' } : { compartmentId, quantity: 1 };
    const options = { method: 'POST' as const, url: `/item-inventory/${path}` };
    const withMachine = await request({ ...options, payload: { ...payload, machineId } });
    expect(withMachine.statusCode).toBe(200);
    expect(withMachine.json().transaction.machineId).toBe(machineId);
    db.machine.findUnique.mockResolvedValue({ ...machine, resourceCd: ' s001 ' });
    expect((await request({ ...options, payload: { ...payload, machineId } })).statusCode).toBe(400);
    const without = await request({ ...options, payload });
    expect(without.statusCode).toBe(200);
    expect(without.json().transaction.machineId).toBeNull();
  });
});

describe('inventory department machine requirement API', () => {
  const url = '/item-inventory/machine-optional-departments';
  const department = '生産技術課';
  const headers = { 'x-client-key': 'key', 'x-kiosk-access-password': '2520' };

  it('lists the optional departments with the locations read authorization', async () => {
    db.inventoryMachineOptionalDepartment.findMany.mockResolvedValue([{ department }]);
    const response = await request({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ departments: [department] });
    expect(db.inventoryMachineOptionalDepartment.findMany).toHaveBeenCalledWith({ orderBy: { department: 'asc' } });
    expect((await request({ method: 'GET', url, headers: {} })).statusCode).toBe(401);
  });

  it('idempotently disables and enables the requirement with a verified settings PIN', async () => {
    const rows = new Set<string>();
    db.inventoryMachineOptionalDepartment.upsert.mockImplementation(async ({ create }) => { rows.add(create.department); });
    db.inventoryMachineOptionalDepartment.deleteMany.mockImplementation(async ({ where }) => { rows.delete(where.department); });
    for (const machineRequired of [false, false, true, true]) {
      const response = await request({ method: 'PUT', url, headers, payload: { department: ` ${department} `, machineRequired } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ department, machineRequired });
      expect(rows.has(department)).toBe(!machineRequired);
    }
    expect(db.inventoryMachineOptionalDepartment.upsert).toHaveBeenCalledWith({ where: { department }, create: { department }, update: {} });
    expect(db.inventoryMachineOptionalDepartment.deleteMany).toHaveBeenCalledWith({ where: { department } });
  });

  it.each([{}, { 'x-client-key': 'key' }, { 'x-client-key': 'key', 'x-kiosk-access-password': '0000' }])('rejects writes without management authorization: %j', async credentials => {
    const response = await request({ method: 'PUT', url, headers: credentials, payload: { department, machineRequired: false } });
    expect([401, 403]).toContain(response.statusCode);
    expect(db.inventoryMachineOptionalDepartment.upsert).not.toHaveBeenCalled();
    expect(db.inventoryMachineOptionalDepartment.deleteMany).not.toHaveBeenCalled();
  });

  it.each([{ department: '', machineRequired: false }, { department: '   ', machineRequired: true }, { department: 'a'.repeat(201), machineRequired: false }, { department, machineRequired: 'false' }, { department }])('rejects invalid settings: %j', async payload => {
    expect((await request({ method: 'PUT', url, headers, payload })).statusCode).toBe(400);
    expect(db.inventoryMachineOptionalDepartment.upsert).not.toHaveBeenCalled();
    expect(db.inventoryMachineOptionalDepartment.deleteMany).not.toHaveBeenCalled();
  });
});
