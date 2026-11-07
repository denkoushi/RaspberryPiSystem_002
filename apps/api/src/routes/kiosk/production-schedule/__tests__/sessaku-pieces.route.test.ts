import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { registerErrorHandler } from '../../../../plugins/error-handler.js';
import { prisma } from '../../../../lib/prisma.js';
import { ApiError } from '../../../../lib/errors.js';
const mocks = vi.hoisted(() => ({ split: vi.fn(), merge: vi.fn(), completion: vi.fn() }));
vi.mock('../../../../services/production-schedule/sessaku-pieces/sessaku-pieces.service.js', () => ({ splitSessakuPieces: mocks.split, mergeSessakuPieces: mocks.merge, setSessakuPieceCompletion: mocks.completion }));
import { registerSessakuPiecesRoutes } from '../sessaku-pieces.js';
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { productionScheduleSessakuPieceAuditLog: { create: vi.fn() } } }));
const base = '/kiosk/production-schedule/grinding-planning-board/pieces';
async function app(authenticated = true, logs: unknown[] = []) {
  const instance = Fastify({ logger: { stream: { write: (line: string) => { logs.push(JSON.parse(line)); } } } });
  registerErrorHandler(instance);
  await registerSessakuPiecesRoutes(instance, { requireClientDevice: async () => { if (!authenticated) throw new ApiError(401, 'unauthorized'); return { clientDevice: { id: 'device-1', name: 'terminal', location: 'site__terminal' } }; }, resolveLocationScopeContext: () => ({ siteKey: 'server-site' }) } as never);
  return instance;
}
afterEach(() => vi.resetAllMocks());
describe('sessaku piece routes', () => {
  it('uses authenticated site scope and forwards the split contract', async () => {
    const instance = await app(); mocks.split.mockResolvedValue({ pieceSetVersion: 1 });
    const payload = { parentItemId: 'row:parent', quantities: [2, 3], expectedPieceSetVersion: 0, itemRevision: 'a'.repeat(64), siteKey: 'untrusted' };
    expect((await instance.inject({ method: 'POST', headers: { 'x-client-key': 'test-client' }, url: `${base}/split`, payload })).statusCode).toBe(200);
    expect(mocks.split).toHaveBeenCalledWith({ ...payload, siteKey: 'server-site', audit: expect.objectContaining({ actorClientDeviceId: 'device-1', actorDeviceName: expect.any(String), requestId: expect.any(String) }) }); await instance.close();
  });
  it.each([[0, 5], [-1, 6], [1.5, 3.5], [5]])('rejects invalid quantities %j', async (...quantities) => {
    const instance = await app();
    expect((await instance.inject({ method: 'POST', headers: { 'x-client-key': 'test-client' }, url: `${base}/split`, payload: { parentItemId: 'row:parent', quantities, expectedPieceSetVersion: 0, itemRevision: 'a'.repeat(64) } })).statusCode).toBe(400);
    expect(mocks.split).not.toHaveBeenCalled(); await instance.close();
  });
  it('requires authentication and preserves gate errors', async () => {
    const denied = await app(false); expect((await denied.inject({ method: 'POST', headers: { 'x-client-key': 'test-client' }, url: `${base}/split`, payload: {} })).statusCode).toBe(401);
    expect(prisma.productionScheduleSessakuPieceAuditLog.create).not.toHaveBeenCalled(); await denied.close();
    const instance = await app(); mocks.split.mockRejectedValue(new ApiError(403, 'disabled', undefined, 'SESSAKU_PIECES_CREATE_DISABLED'));
    expect((await instance.inject({ method: 'POST', headers: { 'x-client-key': 'test-client' }, url: `${base}/split`, payload: { parentItemId: 'row:parent', quantities: [2, 3], expectedPieceSetVersion: 0, itemRevision: 'a'.repeat(64) } })).statusCode).toBe(403); await instance.close();
  });
  it.each([true, false])('records uncomplete for an invalid incomplete request (authenticated=%s)', async (authenticated) => {
    const logs: unknown[] = [];
    const instance = await app(authenticated, logs);
    const response = await instance.inject({ method: 'PUT', url: `${base}/${randomUUID()}/completion`, payload: { intent: 'incomplete', expectedPieceSetVersion: 'invalid' } });
    expect(response.statusCode).toBe(authenticated ? 400 : 401);
    if (authenticated) {
      expect(prisma.productionScheduleSessakuPieceAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'uncomplete', httpStatus: 400, errorCode: 'VALIDATION_ERROR' }) });
    } else {
      expect(prisma.productionScheduleSessakuPieceAuditLog.create).not.toHaveBeenCalled();
      expect(logs).toContainEqual(expect.objectContaining({ event: 'sessaku_piece.uncomplete', action: 'uncomplete', httpStatus: 401 }));
    }
    expect(mocks.completion).not.toHaveBeenCalled();
    await instance.close();
  });
  it.each([null, [], 'invalid', {}, { intent: 'unknown' }])('safely defaults action for body %j', async (body) => {
    const instance = await app();
    expect((await instance.inject({ method: 'PUT', url: `${base}/${randomUUID()}/completion`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) })).statusCode).toBe(400);
    expect(prisma.productionScheduleSessakuPieceAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'complete', httpStatus: 400 }) });
    await instance.close();
  });
  it('validates merge identity and completion intent', async () => {
    const instance = await app(); const pieceId = randomUUID();
    expect((await instance.inject({ method: 'POST', headers: { 'x-client-key': 'test-client' }, url: `${base}/merge`, payload: { parentItemId: 'row:parent', pieceIds: [pieceId, pieceId], expectedPieceSetVersion: 1, itemRevisions: {} } })).statusCode).toBe(400);
    mocks.completion.mockResolvedValue({ parentIsCompleted: false });
    const payload = { intent: 'incomplete', expectedPieceSetVersion: 2, itemRevision: 'a'.repeat(64) };
    expect((await instance.inject({ method: 'PUT', headers: { 'x-client-key': 'test-client' }, url: `${base}/${pieceId}/completion`, payload })).statusCode).toBe(200);
    expect(mocks.completion).toHaveBeenCalledWith({ ...payload, siteKey: 'server-site', pieceId, audit: expect.objectContaining({ action: 'uncomplete' }) }); await instance.close();
  });
});
