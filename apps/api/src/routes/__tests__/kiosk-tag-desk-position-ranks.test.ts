import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/errors.js';
import { registerErrorHandler } from '../../plugins/error-handler.js';
import { KNOWLEDGE_POSITION_RANKS } from '../../services/knowledge/knowledge-position-rank.js';
import { PrismaKnowledgeReviewerRepository } from '../../services/knowledge/prisma-knowledge-reviewer.repository.js';
import { registerKioskTagDeskRoutes } from '../kiosk/tag-desk.js';

vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  requireKioskClientDevice: async (key: string) => {
    if (key !== 'valid-key') throw new ApiError(401, '端末キーが必要です');
    return { clientDevice: { id: 'device' } };
  }
}));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared',
  verifyDueManagementAccessPassword: async ({ password }: { password: string }) => ({ success: password === '4821' })
}));

const headers = { 'x-client-key': 'valid-key', 'x-kiosk-access-password': '4821' };
const url = '/kiosk/tag-desk/position-ranks';

describe('kiosk position ranks API', () => {
  let app: ReturnType<typeof Fastify>;
  let listRanks: ReturnType<typeof vi.spyOn>;
  let replaceRanks: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', 'false');
    listRanks = vi.spyOn(PrismaKnowledgeReviewerRepository.prototype, 'listRanks').mockResolvedValue({ ranks: [], unmappedPositions: [{ positionName: '主事', employeeCount: 3 }] });
    replaceRanks = vi.spyOn(PrismaKnowledgeReviewerRepository.prototype, 'replaceRanks').mockResolvedValue(undefined);
    app = Fastify();
    registerErrorHandler(app);
    await registerKioskTagDeskRoutes(app);
  });
  afterEach(async () => { await app.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each(['GET', 'PUT'] as const)('requires terminal key and operation password for %s', async method => {
    for (const [auth, status] of [
      [{}, 401], [{ 'x-kiosk-access-password': '4821' }, 401],
      [{ 'x-client-key': 'invalid', 'x-kiosk-access-password': '4821' }, 401],
      [{ 'x-client-key': 'valid-key' }, 403], [{ ...headers, 'x-kiosk-access-password': '0000' }, 403]
    ] as const) {
      const response = await app.inject({ method, url, headers: auth, ...(method === 'PUT' ? { payload: { ranks: [] } } : {}) });
      expect(response.statusCode).toBe(status);
    }
    expect(listRanks).not.toHaveBeenCalled(); expect(replaceRanks).not.toHaveBeenCalled();
  });
  it('lists through the existing repository with knowledge disabled', async () => {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ranks: [], unmappedPositions: [{ positionName: '主事', employeeCount: 3 }] });
    expect(listRanks).toHaveBeenCalledOnce();
  });
  it('replaces the whole mapping accepting all six ranks and empty mappings', async () => {
    const ranks = KNOWLEDGE_POSITION_RANKS.map(rank => ({ positionName: ` ${rank} `, rank }));
    const response = await app.inject({ method: 'PUT', url, headers, payload: { ranks } });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ ok: true });
    expect(replaceRanks).toHaveBeenCalledWith(ranks.map(row => ({ ...row, positionName: row.positionName.trim() })));
    expect((await app.inject({ method: 'PUT', url, headers, payload: { ranks: [] } })).statusCode).toBe(200);
    expect(replaceRanks).toHaveBeenLastCalledWith([]);
  });
  it.each([
    { ranks: [{ positionName: '主任', rank: 'boss' }] },
    { ranks: [{ positionName: '主任', rank: 'leader' }, { positionName: ' 主任 ', rank: 'general' }] },
    { ranks: [{ positionName: '', rank: 'leader' }] },
    { ranks: [], extra: true },
    { ranks: Array.from({ length: 201 }, (_, i) => ({ positionName: `${i}`, rank: 'general' })) }
  ])('rejects invalid mapping input %j without a write', async payload => {
    expect((await app.inject({ method: 'PUT', url, headers, payload })).statusCode).toBe(400);
    expect(replaceRanks).not.toHaveBeenCalled();
  });
  it('reports repository failure without returning success', async () => {
    replaceRanks.mockRejectedValueOnce(new Error('write failed'));
    expect((await app.inject({ method: 'PUT', url, headers, payload: { ranks: [] } })).statusCode).toBe(500);
  });
});
