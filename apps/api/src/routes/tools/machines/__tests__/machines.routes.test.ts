import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

vi.mock('../../../../config/env.js', () => ({
  env: { JWT_ACCESS_SECRET: 'machine-route-test-secret', ADMIN_MFA_REQUIRED: false },
}));
vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    machine: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    productionScheduleResourceMaster: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../../../lib/prisma.js';
import { registerMachineRoutes } from '../index.js';

const machine = {
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
  vi.mocked(prisma.machine.findUnique).mockResolvedValue(machine);
  vi.mocked(prisma.machine.update).mockImplementation(async ({ data }) => ({ ...machine, ...data }) as typeof machine);
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
