import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

vi.mock('../../../../config/env.js', () => ({
  env: { JWT_ACCESS_SECRET: 'machine-route-test-secret', ADMIN_MFA_REQUIRED: false },
}));
vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    site: { findUnique: vi.fn() },
    machineNfcTag: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    employee: { findUnique: vi.fn() },
    item: { findUnique: vi.fn() },
    measuringInstrumentTag: { findUnique: vi.fn() },
    riggingGearTag: { findUnique: vi.fn() },
    inventoryNfcTag: { findUnique: vi.fn() },
    nfcTagBindingEvent: { create: vi.fn() },
    $transaction: vi.fn(),
    machine: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    productionScheduleResourceMaster: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../../../lib/prisma.js';
import { registerMachineRoutes } from '../index.js';

const machine = {
  siteKey: null,
  id: 'm1', equipmentManagementNumber: '10018', name: '加工機', resourceCd: '021',
  shortName: null, classification: null, operatingStatus: null, ncManual: null,
  maker: null, processClassification: null, coolant: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const headers = (role = 'ADMIN') => ({
  authorization: `Bearer ${jwt.sign({ sub: 'u1', username: 'tester', role }, 'machine-route-test-secret')}`,
});
let app: FastifyInstance;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (work: unknown) => (work as (tx: unknown) => Promise<unknown>)(prisma));
  vi.mocked(prisma.machine.findUnique).mockResolvedValue(machine);
  vi.mocked(prisma.machine.update).mockImplementation((async ({ data }: { data: object }) => ({ ...machine, ...data })) as never);
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    void reply.code(error instanceof ZodError ? 400 : (error.statusCode ?? 500)).send({ message: error.message });
  });
  await registerMachineRoutes(app);
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('machine resourceCd routes', () => {
  it.each(['ADMIN', 'MANAGER', 'VIEWER'])('includes resourceCd in the list for %s', async (role) => {
    vi.mocked(prisma.machine.findMany).mockResolvedValue([machine, { ...machine, id: 'm2', resourceCd: null }]);
    const response = await app.inject({ method: 'GET', url: '/machines', headers: headers(role) });
    expect(response.statusCode).toBe(200);
    expect(response.json().machines.map((row: typeof machine) => row.resourceCd)).toEqual(['021', null]);
  });

  it.each([
    [' 022 ', '022'], ['x'.repeat(20), 'x'.repeat(20)], ['', null], ['   ', null], [null, null],
  ])('updates resourceCd %j to %j', async (resourceCd, expected) => {
    const response = await app.inject({ method: 'PUT', url: '/machines/m1', headers: headers(), payload: { resourceCd } });
    expect(response.statusCode).toBe(200);
    expect(response.json().machine.resourceCd).toBe(expected);
    expect(prisma.machine.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resourceCd: expected }) }));
  });

  it('does not overwrite resourceCd when omitted', async () => {
    const response = await app.inject({ method: 'PUT', url: '/machines/m1', headers: headers(), payload: { name: '更新' } });
    expect(response.statusCode).toBe(200);
    expect(vi.mocked(prisma.machine.update).mock.calls[0][0].data.resourceCd).toBeUndefined();
  });

  it.each(['x'.repeat(21), 21])('rejects invalid resourceCd %j', async (resourceCd) => {
    const response = await app.inject({ method: 'PUT', url: '/machines/m1', headers: headers(), payload: { resourceCd } });
    expect(response.statusCode).toBe(400);
    expect(prisma.machine.update).not.toHaveBeenCalled();
  });

  it('accepts resourceCd on creation', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.machine.create).mockResolvedValue(machine);
    const response = await app.inject({ method: 'POST', url: '/machines', headers: headers(), payload: {
      equipmentManagementNumber: '10018', name: '加工機', resourceCd: ' 021 ',
    } });
    expect(response.statusCode).toBe(200);
    expect(prisma.machine.create).toHaveBeenCalledWith({ data: expect.objectContaining({ resourceCd: '021' }) });
  });

  it.each(['ADMIN', 'MANAGER'])('returns one representative name per resourceCd for %s', async (role) => {
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([
      { resourceCd: '021', resourceName: 'A' }, { resourceCd: '021', resourceName: 'B' },
      { resourceCd: '022', resourceName: 'C' },
    ] as Awaited<ReturnType<typeof prisma.productionScheduleResourceMaster.findMany>>);
    const response = await app.inject({ method: 'GET', url: '/machines/resource-choices', headers: headers(role) });
    expect(response.statusCode).toBe(200);
    expect(response.json().resources).toEqual([{ resourceCd: '021', resourceName: 'A' }, { resourceCd: '022', resourceName: 'C' }]);
    expect(prisma.productionScheduleResourceMaster.findMany).toHaveBeenCalledWith({
      select: { resourceCd: true, resourceName: true }, orderBy: [{ resourceCd: 'asc' }, { resourceName: 'asc' }],
    });
  });

  it.each([
    ['GET', '/machines/resource-choices'], ['PUT', '/machines/m1'],
  ] as const)('requires edit permission for %s %s', async (method, url) => {
    const anonymous = await app.inject({ method, url });
    const viewer = await app.inject({ method, url, headers: headers('VIEWER') });
    expect(anonymous.statusCode).toBe(401);
    expect(viewer.statusCode).toBe(403);
    expect(prisma.machine.update).not.toHaveBeenCalled();
    expect(prisma.productionScheduleResourceMaster.findMany).not.toHaveBeenCalled();
  });
});


describe('machine sites and NFC routes', () => {
  it('accepts a site filter and rejects unknown sites', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ key: 'a' } as never);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([]);
    expect((await app.inject({ method: 'GET', url: '/machines?siteKey=a', headers: headers() })).statusCode).toBe(200);
    expect(prisma.machine.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { siteKey: 'a' } }));
    expect((await app.inject({ method: 'GET', url: '/machines?siteKey=', headers: headers() })).statusCode).toBe(200);
    expect(prisma.machine.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { siteKey: null } }));
    vi.mocked(prisma.site.findUnique).mockResolvedValue(null);
    expect((await app.inject({ method: 'GET', url: '/machines?siteKey=missing', headers: headers() })).statusCode).toBe(400);
  });

  it('saves a known site and normalizes an empty site to null', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ key: 'a' } as never);
    for (const [siteKey, expected] of [[' a ', 'a'], ['', null], [null, null]]) {
      const response = await app.inject({ method: 'PUT', url: '/machines/m1', headers: headers('MANAGER'), payload: { siteKey } });
      expect(response.statusCode).toBe(200);
      expect(response.json().machine.siteKey).toBe(expected);
    }
  });

  it('validates the site on creation and update', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(null);
    for (const method of ['POST', 'PUT'] as const) {
      const response = await app.inject({ method, url: method === 'POST' ? '/machines' : '/machines/m1', headers: headers(), payload: { siteKey: 'missing', name: '旋盤', equipmentManagementNumber: '1' } });
      expect(response.statusCode).toBe(400);
    }
    expect(prisma.machine.create).not.toHaveBeenCalled();
    expect(prisma.machine.update).not.toHaveBeenCalled();
  });

  it('accepts siteKey on creation', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ key: 'a' } as never);
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.machine.create).mockResolvedValue({ ...machine, siteKey: 'a' });
    const response = await app.inject({ method: 'POST', url: '/machines', headers: headers(), payload: { siteKey: ' a ', name: '旋盤', equipmentManagementNumber: '1' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().machine.siteKey).toBe('a');
  });

  it('includes site and tags in the list query', async () => {
    vi.mocked(prisma.machine.findMany).mockResolvedValue([{ ...machine, site: { key: 'a', displayName: '工場' }, nfcTags: [{ id: 't', uid: 'ABCD' }] }] as never);
    const response = await app.inject({ method: 'GET', url: '/machines', headers: headers() });
    expect(response.json().machines[0]).toMatchObject({ site: { key: 'a', displayName: '工場' }, nfcTags: [{ id: 't', uid: 'ABCD' }] });
    expect(prisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ site: expect.anything(), nfcTags: expect.anything() }) }));
  });

  it('adds and removes a normalized tag and records both events', async () => {
    vi.mocked(prisma.machineNfcTag.create).mockResolvedValue({ id: 't', uid: 'ABCD', machineId: 'm1' } as never);
    const added = await app.inject({ method: 'POST', url: '/machines/m1/nfc-tags', headers: headers('MANAGER'), payload: { uid: ' ABCD ' } });
    expect(added.statusCode).toBe(200);
    expect(prisma.machineNfcTag.create).toHaveBeenCalledWith({ data: { machineId: 'm1', uid: 'ABCD' } });
    vi.mocked(prisma.machineNfcTag.findUnique).mockResolvedValue({ id: 't', uid: 'ABCD', machineId: 'm1', machine } as never);
    const removed = await app.inject({ method: 'DELETE', url: '/machines/m1/nfc-tags/t', headers: headers() });
    expect(removed.statusCode).toBe(200);
    for (const action of ['LINK', 'UNLINK']) expect(prisma.nfcTagBindingEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action, targetKind: 'machine', targetId: 'm1', uid: 'ABCD' }) });
  });

  it.each(['employee', 'item', 'measuringInstrumentTag', 'riggingGearTag', 'inventoryNfcTag', 'machineNfcTag'] as const)('rejects a UID bound to %s', async domain => {
    const usage = { displayName: '社員', name: '工具', measuringInstrument: { name: '計測器' }, riggingGear: { name: '吊具' }, kind: 'RESTOCK', machine: { name: '旋盤' } };
    vi.mocked(prisma[domain].findUnique).mockResolvedValue(usage as never);
    const response = await app.inject({ method: 'POST', url: '/machines/m1/nfc-tags', headers: headers(), payload: { uid: 'ABCD' } });
    expect(response.statusCode).toBe(409);
    expect(prisma.machineNfcTag.create).not.toHaveBeenCalled();
  });

  it('refuses removing a tag belonging to another machine', async () => {
    vi.mocked(prisma.machineNfcTag.findUnique).mockResolvedValue({ machineId: 'other' } as never);
    const response = await app.inject({ method: 'DELETE', url: '/machines/m1/nfc-tags/t', headers: headers() });
    expect(response.statusCode).toBe(404);
    expect(prisma.machineNfcTag.delete).not.toHaveBeenCalled();
  });

  it.each(['POST', 'DELETE'] as const)('denies viewer NFC writes (%s)', async method => {
    const response = await app.inject({ method, url: '/machines/m1/nfc-tags' + (method === 'DELETE' ? '/t' : ''), headers: headers('VIEWER'), ...(method === 'POST' ? { payload: { uid: 'ABCD' } } : {}) });
    expect(response.statusCode).toBe(403);
  });
});
