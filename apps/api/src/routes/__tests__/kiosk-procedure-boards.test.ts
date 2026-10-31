import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { emptyLayout, placeItem } from '../../services/knowledge/procedure-board-layout.js';
import { ProcedureBoardService } from '../../services/knowledge/procedure-board.service.js';
import type { PrismaProcedureBoardRepository } from '../../services/knowledge/prisma-procedure-board.repository.js';
import { registerKioskProcedureBoardRoutes } from '../kiosk-procedure-boards.js';

const mocks = vi.hoisted(() => ({ enabled: true, repository: { listProcedures: vi.fn(), getOrCreate: vi.fn(), get: vi.fn(), save: vi.fn(),
  appendEvents: vi.fn(), materials: vi.fn(), image: vi.fn(), startTrial: vi.fn(), weeklyMetrics: vi.fn() }, readDisplay: vi.fn(), device: { findUniqueOrThrow: vi.fn(), update: vi.fn() } }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { clientDevice: mocks.device } }));
vi.mock('../../lib/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/kiosk-inquiry/system-notice-sources.js', () => ({ deliverTelemetryNotice: vi.fn() }));
vi.mock('../../services/alerts/alerts-config.js', () => ({ loadAlertsDispatcherConfig: vi.fn(), resolveRouteKey: vi.fn() }));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  requireKioskClientDevice: async (key: unknown) => {
    if (key !== 'valid-key') throw new ApiError(401, 'invalid key');
    return { clientDevice: { id: 'device-1' } };
  },
}));
vi.mock('../../services/mobile-placement/client-capabilities.service.js', () => ({
  requireProcedureBoardEnabled: async () => { if (!mocks.enabled) throw new ApiError(403, 'disabled', undefined, 'PROCEDURE_BOARD_FORBIDDEN'); },
}));
vi.mock('../../services/knowledge/knowledge-runtime.js', () => ({ getKnowledgeRuntime: () => ({
  procedureBoards: new ProcedureBoardService(mocks.repository as unknown as PrismaProcedureBoardRepository), assets: { readDisplay: mocks.readDisplay },
}) }));

const headers = { 'x-client-key': 'valid-key' };
const url = '/kiosk/procedure-boards/topic-1';
function server() {
  const app = Fastify();
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; details?: unknown }, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ code: error.code, ...(error.details as object ?? {}) });
  });
  registerKioskProcedureBoardRoutes(app); return app;
}

describe('Kiosk procedure board HTTP contract', () => {
  beforeEach(() => { vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', 'true'); mocks.enabled = true; vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it('treats null/false as disabled and preserves capability values on omitted admin updates', async () => {
    const capabilities = await vi.importActual<typeof import('../../services/mobile-placement/client-capabilities.service.js')>('../../services/mobile-placement/client-capabilities.service.js');
    for (const value of [null, false, true]) {
      mocks.device.findUniqueOrThrow.mockResolvedValue({ shelfLayoutEditEnabled: false, haizenEdgeEnabled: false, procedureBoardEnabled: value });
      expect(await capabilities.getClientCapabilities('device-1')).toEqual({ shelfLayoutEditEnabled: false, haizenEdgeEnabled: false, procedureBoardEnabled: value === true });
      if (value === true) await expect(capabilities.requireProcedureBoardEnabled('device-1')).resolves.toBeUndefined();
      else await expect(capabilities.requireProcedureBoardEnabled('device-1')).rejects.toMatchObject({ statusCode: 403, code: 'PROCEDURE_BOARD_FORBIDDEN' });
    }
    const { updateClientDevice } = await import('../../services/clients/client-telemetry.service.js');
    mocks.device.update.mockResolvedValue({ id: 'device-1', procedureBoardEnabled: true });
    await updateClientDevice({ id: 'device-1', name: '更新' });
    expect(mocks.device.update.mock.calls.at(-1)?.[0].data).not.toHaveProperty('procedureBoardEnabled');
    for (const value of [false, true]) {
      await updateClientDevice({ id: 'device-1', procedureBoardEnabled: value });
      expect(mocks.device.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ procedureBoardEnabled: value }) }));
    }
  });
  it('requires client authentication and both capabilities on every route, before body parsing', async () => {
    const app = server();
    for (const [method, path] of [['GET', '/procedures'], ['POST', ''], ['GET', ''], ['PUT', ''], ['GET', '/materials'],
      ['GET', `/materials/m1/images/${'a'.repeat(64)}`], ['POST', '/events'], ['PUT', '/trial'], ['GET', '/metrics']] as const) {
      const endpoint = path === '/procedures' ? '/kiosk/procedure-boards/procedures' : url + path;
      expect((await app.inject({ method, url: endpoint, headers: { authorization: 'Bearer admin' } })).statusCode).toBe(401);
      mocks.enabled = false;
      expect((await app.inject({ method, url: endpoint, headers })).statusCode).toBe(403);
      mocks.enabled = true;
    }
    vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', 'false');
    expect((await app.inject({ method: 'PUT', url, headers: { ...headers, 'content-type': 'application/json' }, payload: '{invalid' })).statusCode).toBe(403);
    await app.close();
  });
  it('creates exactly once, gets without creating, paginates procedures and materials', async () => {
    const app = server(); mocks.repository.getOrCreate.mockResolvedValueOnce({ created: true, boardId: 'b1', layout: emptyLayout() }).mockResolvedValueOnce({ created: false, boardId: 'b1', layout: emptyLayout() });
    expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(200);
    expect(mocks.repository.getOrCreate).toHaveBeenCalledWith('topic-1', 'device-1');
    mocks.repository.get.mockRejectedValue(new ApiError(404, 'missing'));
    expect((await app.inject({ url, headers })).statusCode).toBe(404);
    mocks.repository.listProcedures.mockResolvedValue({ procedures: [], nextCursor: null });
    expect((await app.inject({ url: '/kiosk/procedure-boards/procedures?cursor=topic-0&limit=100', headers })).statusCode).toBe(200);
    expect(mocks.repository.listProcedures).toHaveBeenCalledWith('topic-0', 100);
    mocks.repository.materials.mockResolvedValue({ materials: [], nextCursor: null });
    expect((await app.inject({ url: url + '/materials?limit=100', headers })).statusCode).toBe(200);
    expect(mocks.repository.materials).toHaveBeenCalledWith('topic-1', undefined, 100);
    expect((await app.inject({ url: url + '/materials?limit=101', headers })).statusCode).toBe(400);
    await app.close();
  });
  it('validates saves, derives device identity, and returns material/optimistic-lock failures', async () => {
    const app = server(); const itemId = randomUUID();
    const layout = placeItem(emptyLayout(), { itemId, kind: 'material', materialId: 'm1', origin: 'human', style: 'body', override: '修正' }, { page: 1, row: 0, col: 0, index: 0, mode: 'row' });
    const event = { id: randomUUID(), type: 'material_placed', payload: { materialId: 'm1', itemId, to: { page: 1, row: 0, col: 0, index: 0 } } };
    const payload = { expectedVersion: 1, layout, event };
    mocks.repository.save.mockResolvedValue({ version: 2, layout, ai: { status: 'unavailable' } });
    expect((await app.inject({ method: 'PUT', url, headers, payload })).json()).toMatchObject({ version: 2, layout, ai: { status: 'unavailable' } });
    expect(mocks.repository.save).toHaveBeenCalledWith('topic-1', 'device-1', 1, layout, event);
    expect((await app.inject({ method: 'PUT', url, headers, payload: { ...payload, clientDeviceId: 'forged' } })).statusCode).toBe(400);
    mocks.repository.save.mockRejectedValueOnce(new ApiError(400, 'foreign material')).mockRejectedValueOnce(new ApiError(409, 'conflict', { currentVersion: 2 }, 'PROCEDURE_BOARD_VERSION_CONFLICT'));
    expect((await app.inject({ method: 'PUT', url, headers, payload })).statusCode).toBe(400);
    const conflict = await app.inject({ method: 'PUT', url, headers, payload });
    expect(conflict.statusCode).toBe(409); expect(conflict.json()).toMatchObject({ currentVersion: 2, code: 'PROCEDURE_BOARD_VERSION_CONFLICT' });
    await app.close();
  });
  it('returns 400 when column widths outnumber columns', async () => {
    const app = server();
    const layout = emptyLayout();
    layout.pages[0].rows = [{ cols: [{ items: [] }], w: [1, 1] }];
    const response = await app.inject({ method: 'PUT', url, headers, payload: { expectedVersion: 1, layout,
      event: { id: randomUUID(), type: 'text_created', payload: { itemId: randomUUID() } } } });
    expect(response.statusCode).toBe(400);
    expect(mocks.repository.save).not.toHaveBeenCalled();
    await app.close();
  });
  it('allows only display/time/audit append events and rejects employee identity and invalid elapsed time', async () => {
    const app = server(); const event = { id: randomUUID(), type: 'material_work', payload: { materialId: 'm1', workId: randomUUID(), activeMs: 4200, completed: true } };
    mocks.repository.appendEvents.mockResolvedValueOnce({ recorded: 1, duplicates: 0 }).mockResolvedValueOnce({ recorded: 0, duplicates: 1 });
    const input = { boardVersion: 2, events: [event] };
    expect((await app.inject({ method: 'POST', url: url + '/events', headers, payload: input })).json()).toEqual({ recorded: 1, duplicates: 0 });
    expect((await app.inject({ method: 'POST', url: url + '/events', headers, payload: input })).json()).toEqual({ recorded: 0, duplicates: 1 });
    for (const invalid of [{ ...event, type: 'item_removed', payload: { itemId: randomUUID() } },
      { ...event, payload: { ...event.payload, employeeId: 'forged' } }, { ...event, payload: { ...event.payload, activeMs: 86400001 } }]) {
      expect((await app.inject({ method: 'POST', url: url + '/events', headers, payload: { ...input, events: [invalid] } })).statusCode).toBe(400);
    }
    await app.close();
  });
  it('checks source image membership before reading bytes and exposes trial/metrics', async () => {
    const app = server(); const imageId = 'a'.repeat(64);
    mocks.repository.image.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(404, 'foreign image'));
    mocks.readDisplay.mockResolvedValue(Buffer.from('jpeg'));
    const path = url + `/materials/m1/images/${imageId}`;
    expect((await app.inject({ url: path, headers })).headers['content-type']).toContain('image/jpeg');
    expect((await app.inject({ url: path, headers })).statusCode).toBe(404); expect(mocks.readDisplay).toHaveBeenCalledTimes(1);
    mocks.repository.startTrial.mockResolvedValue({ version: 3 });
    expect((await app.inject({ method: 'PUT', url: url + '/trial', headers, payload: { expectedVersion: 2, startedAt: '2026-11-01T00:00:00+09:00' } })).statusCode).toBe(200);
    mocks.repository.weeklyMetrics.mockResolvedValue({ timezone: 'Asia/Tokyo', weeks: [] });
    expect((await app.inject({ url: url + '/metrics?trialStart=2026-10-31T15:00:00Z&weeks=4', headers })).json()).toEqual({ timezone: 'Asia/Tokyo', weeks: [] });
    await app.close();
  });
});
