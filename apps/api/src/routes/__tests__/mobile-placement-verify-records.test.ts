import { Prisma } from '@prisma/client';
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../../services/production-schedule/seiban-machine-display-names.service.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { registerMobileVerifyRecordRoutes } from '../mobile-placement/verify-records.js';

vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {
  mobileSlipVerifyRecord: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  orderPlacementEvent: { findMany: vi.fn() }, csvDashboardRow: { findMany: vi.fn() }
} }));
vi.mock('../../services/production-schedule/seiban-machine-display-names.service.js', () => ({ resolveSeibanMachineDisplayNamesBatched: vi.fn() }));

let app: ReturnType<typeof Fastify>;
const clientVerifyId = '9df8a3d0-77bd-40d4-9c05-2cf86f06c734';
const clientRecordId = '7df8a3d0-77bd-40d4-9c05-2cf86f06c734';
const body = { clientVerifyId, verifiedAt: '2026-10-29T03:00:00.000Z', transferOrderBarcodeRaw: '0002178005',
  actualOrderBarcodeRaw: '4501238876', actualFseibanRaw: '', outcome: 'match', reason: 'match' };
const duplicate = () => new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });
const post = (payload = body) => app.inject({ method: 'POST', url: '/mobile-placement/verify-records', headers: { 'x-client-key': 'device-test-key' }, payload });
beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(requireClientDevice).mockImplementation(async (key) => {
    if (key !== 'device-test-key') throw new ApiError(401, 'unauthorized');
    return { clientDevice: { id: 'device' } } as never;
  });
  vi.mocked(prisma.mobileSlipVerifyRecord.create).mockResolvedValue({ id: 'record', ...body } as never);
  vi.mocked(prisma.mobileSlipVerifyRecord.updateMany).mockResolvedValue({ count: 0 });
  vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([]);
  vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([]);
  vi.mocked(prisma.orderPlacementEvent.findMany).mockResolvedValue([]);
  vi.mocked(resolveSeibanMachineDisplayNamesBatched).mockResolvedValue({ machineNames: {} });
  app = Fastify();
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ message: error.message });
  });
  await registerMobileVerifyRecordRoutes(app);
});
afterEach(async () => { await app.close(); });

describe('mobile verify records', () => {
  it('creates a record with 201 and the authenticated device', async () => {
    expect((await post()).statusCode).toBe(201);
    expect(prisma.mobileSlipVerifyRecord.create).toHaveBeenCalledWith({ data: { ...body, verifiedAt: new Date(body.verifiedAt), clientDeviceId: 'device' } });
  });
  it('returns 409 for a duplicate, including concurrent creation', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.create).mockRejectedValue(duplicate());
    expect((await post()).statusCode).toBe(409);
    expect(prisma.mobileSlipVerifyRecord.updateMany).not.toHaveBeenCalled();
  });
  it('sets an empty placement link on the same device with 200', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.create).mockRejectedValue(duplicate());
    vi.mocked(prisma.mobileSlipVerifyRecord.updateMany).mockResolvedValue({ count: 1 });
    const response = await post({ ...body, clientRecordId } as typeof body);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ clientVerifyId, clientRecordId });
    expect(prisma.mobileSlipVerifyRecord.updateMany).toHaveBeenCalledWith({
      where: { clientVerifyId, clientDeviceId: 'device', clientRecordId: null }, data: { clientRecordId }
    });
  });
  it('does not overwrite an existing link or another device record', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.create).mockRejectedValue(duplicate());
    expect((await post({ ...body, clientRecordId } as typeof body)).statusCode).toBe(409);
  });
  it.each(['POST', 'GET'] as const)('requires a key for %s', async (method) => {
    for (const headers of [{}, { 'x-client-key': 'wrong' }]) {
      expect((await app.inject({ method, url: '/mobile-placement/verify-records', headers, ...(method === 'POST' ? { payload: body } : {}) })).statusCode).toBe(401);
    }
    expect(prisma.mobileSlipVerifyRecord.create).not.toHaveBeenCalled();
    expect(prisma.mobileSlipVerifyRecord.findMany).not.toHaveBeenCalled();
  });
  it('rejects malformed records and unsupported days', async () => {
    expect((await post({ ...body, clientVerifyId: 'invalid' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/mobile-placement/verify-records?days=2', headers: { 'x-client-key': 'device-test-key' } })).statusCode).toBe(400);
  });
  it('returns all outcomes, mismatch kinds and the placed shelf in the kiosk contract', async () => {
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue([
      ['match', 'match'], ['mismatch', 'different_seiban'], ['mismatch', 'different_part'], ['not_found', 'part_required'], ['error', null]
    ].map(([outcome, reason], index) => ({ ...body, id: String(index), verifiedAt: new Date(body.verifiedAt), clientDeviceId: 'device',
      clientDevice: { name: 'スマホ' }, clientRecordId, outcome, reason, expectedFseiban: 'FS1', expectedFhincd: 'P1', expectedPartName: 'ブラケット' })) as never);
    vi.mocked(prisma.orderPlacementEvent.findMany).mockResolvedValue([{ clientRecordId, clientDeviceId: 'device', shelfCodeRaw: '北-1', branchNo: 0 }] as never);
    vi.mocked(resolveSeibanMachineDisplayNamesBatched).mockResolvedValue({ machineNames: { FS1: '機械' } });
    const response = await app.inject({ method: 'GET', url: '/mobile-placement/verify-records?days=1', headers: { 'x-client-key': 'device-test-key' } });
    expect(response.statusCode).toBe(200);
    const { records } = response.json();
    expect(records.map((row: { result: string }) => row.result)).toEqual(['match', 'mismatch', 'mismatch', 'not_found', 'error']);
    expect(records.map((row: { mismatch: string | null }) => row.mismatch)).toEqual([null, 'fseiban', 'part', null, null]);
    expect(records[0]).toEqual({ id: '0', verifiedAt: body.verifiedAt, deviceName: 'スマホ', result: 'match', reason: 'match',
      transfer: { orderNo: body.transferOrderBarcodeRaw, partNo: 'P1', fseiban: 'FS1' },
      actual: { slipNo: body.actualOrderBarcodeRaw, partNo: null, fseiban: null }, mismatch: null,
      fhinmei: 'ブラケット', machineName: '機械', placedShelfCodeRaw: '北-1', branchNo: 0 });
  });
});
