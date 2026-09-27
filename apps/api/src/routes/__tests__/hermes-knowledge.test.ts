import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerHermesKnowledgeRoutes } from '../hermes-knowledge.js';

const mocks = vi.hoisted(() => ({
  receive: vi.fn(), choose: vi.fn(), readySources: vi.fn(), get: vi.fn(), kick: vi.fn(),
  readDisplay: vi.fn(), listPublished: vi.fn(), getPublished: vi.fn(), triageGet: vi.fn().mockResolvedValue([]),
  pending: vi.fn(), decide: vi.fn(), searchTopics: vi.fn(), procedureKick: vi.fn(),
}));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  parseKioskApiClientKeyHeader: (value: unknown) => typeof value === 'string' ? value : undefined,
  findClientDeviceByApiKey: async (key: string) => key === 'valid-key' ? { id: 'device-one' } : null,
}));
vi.mock('../../services/knowledge/knowledge-runtime.js', () => ({
  getKnowledgeRuntime: () => ({ intake: { receive: mocks.receive }, repository: { choose: mocks.choose, readySources: mocks.readySources, get: mocks.get },
    assets: { readDisplay: mocks.readDisplay }, worker: { kick: mocks.kick, stop: async () => {} }, documents: { initialize: async () => {} },
    procedures: { listPublished: mocks.listPublished, getPublished: mocks.getPublished, searchTopics: mocks.searchTopics },
    triage: { get: mocks.triageGet }, triageService: { pending: mocks.pending, decide: mocks.decide },
    procedureWorker: { kick: mocks.procedureKick }, workTypes: async () => ['段取り', 'その他'] }),
}));

describe('Knowledge API authentication boundary', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); mocks.triageGet.mockResolvedValue([]); });
  const server = () => { vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', 'true'); const app = Fastify(); registerHermesKnowledgeRoutes(app); return app; };

  it('authenticates before parsing a large/upload body', async () => {
    const app = server();
    const response = await app.inject({ method: 'POST', url: '/hermes-knowledge/intakes', headers: { 'content-type': 'application/json' }, payload: '{invalid' });
    expect(response.statusCode).toBe(401);
    expect(mocks.receive).not.toHaveBeenCalled(); await app.close();
  });
  it('derives the owner from the validated device, never the request body', async () => {
    const app = server(); mocks.receive.mockResolvedValue({ id: 'accepted' });
    const response = await app.inject({ method: 'POST', url: '/hermes-knowledge/intakes', headers: { 'x-client-key': 'valid-key' }, payload: { ownerKey: 'forged' } });
    expect(response.statusCode).toBe(200);
    expect(mocks.receive).toHaveBeenCalledWith('client:device-one', { ownerKey: 'forged' }); await app.close();
  });
  it('does not fall back to a shared device when user authentication is invalid', async () => {
    const app = server();
    const response = await app.inject({ method: 'POST', url: '/hermes-knowledge/intakes', headers: { authorization: 'Bearer invalid', 'x-client-key': 'valid-key' }, payload: {} });
    expect(response.statusCode).toBe(401); expect(mocks.receive).not.toHaveBeenCalled(); await app.close();
  });
  it('requires both a published source and its image membership', async () => {
    const app = server(); const id = '123e4567-e89b-42d3-a456-426614174000'; const image = 'a'.repeat(64);
    mocks.readySources.mockResolvedValue([{ source: { id, images: [{ id: image }] } }]); mocks.readDisplay.mockResolvedValue(Buffer.from('jpeg'));
    const ok = await app.inject({ url: `/hermes-knowledge/sources/${id}/images/${image}`, headers: { 'x-client-key': 'valid-key' } });
    expect(ok.statusCode).toBe(200); expect(ok.headers['content-type']).toContain('image/jpeg');
    const hidden = await app.inject({ url: `/hermes-knowledge/sources/${id}/images/${'b'.repeat(64)}`, headers: { 'x-client-key': 'valid-key' } });
    expect(hidden.statusCode).toBe(404); expect(mocks.readDisplay).toHaveBeenCalledTimes(1); await app.close();
  });
  it('lists and reads only published procedures behind authentication', async () => {
    const app = server(); const id = '123e4567-e89b-42d3-a456-426614174000';
    mocks.listPublished.mockResolvedValue([{ procedureId: id, title: '部品Aの段取り' }]);
    expect((await app.inject({ url: '/hermes-knowledge/procedures' })).statusCode).toBe(401);
    const list = await app.inject({ url: '/hermes-knowledge/procedures', headers: { 'x-client-key': 'valid-key' } });
    expect(list.json()).toEqual({ procedures: [{ procedureId: id, title: '部品Aの段取り' }] });
    mocks.getPublished.mockResolvedValue(null);
    expect((await app.inject({ url: `/hermes-knowledge/procedures/${id}`, headers: { 'x-client-key': 'valid-key' } })).statusCode).toBe(404);
    await app.close();
  });
  it('serves only photos referenced by the published procedure revision', async () => {
    const app = server(); const id = '123e4567-e89b-42d3-a456-426614174000'; const image = 'c'.repeat(64);
    mocks.getPublished.mockResolvedValue({ procedureId: id, steps: [{ photos: [{ imageId: image, caption: '' }] }] }); mocks.readDisplay.mockResolvedValue(Buffer.from('jpeg'));
    const ok = await app.inject({ url: `/hermes-knowledge/procedures/${id}/images/${image}`, headers: { 'x-client-key': 'valid-key' } });
    expect(ok.statusCode).toBe(200); expect(ok.headers['content-type']).toContain('image/jpeg');
    const other = await app.inject({ url: `/hermes-knowledge/procedures/${id}/images/${'d'.repeat(64)}`, headers: { 'x-client-key': 'valid-key' } });
    expect(other.statusCode).toBe(404); expect(mocks.readDisplay).toHaveBeenCalledTimes(1); await app.close();
  });
  it('returns the triage state with a received post and explains an unknown tag', async () => {
    const app = server(); mocks.receive.mockResolvedValue({ id: 'post-1' });
    mocks.triageGet.mockResolvedValue([{ intakeId: 'post-1', state: 'suggesting', suggestions: null, decidedProcedureId: null }]);
    const ok = await app.inject({ method: 'POST', url: '/hermes-knowledge/intakes', headers: { 'x-client-key': 'valid-key' }, payload: {} });
    expect(ok.json()).toEqual({ id: 'post-1', triage: { state: 'suggesting', suggestions: null, decidedProcedureId: null } });
    mocks.receive.mockRejectedValue(new Error('UNKNOWN_POSTER'));
    const unknown = await app.inject({ method: 'POST', url: '/hermes-knowledge/intakes', headers: { 'x-client-key': 'valid-key' }, payload: {} });
    expect(unknown.statusCode).toBe(400); expect(unknown.json().message).toContain('社員タグ'); await app.close();
  });
  it('lets only the poster decide and rebuilds after a decision', async () => {
    const app = server(); const id = '123e4567-e89b-42d3-a456-426614174000';
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/triage/${id}/decide`, payload: {} })).statusCode).toBe(401);
    mocks.decide.mockResolvedValue({ procedureId: 'p1' });
    const ok = await app.inject({ method: 'POST', url: `/hermes-knowledge/triage/${id}/decide`, headers: { 'x-client-key': 'valid-key' }, payload: { any: 1 } });
    expect(ok.json()).toEqual({ procedureId: 'p1' }); expect(mocks.decide).toHaveBeenCalledWith(id, { any: 1 }); expect(mocks.procedureKick).toHaveBeenCalled();
    mocks.decide.mockRejectedValue(new Error('TRIAGE_NOT_YOURS'));
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/triage/${id}/decide`, headers: { 'x-client-key': 'valid-key' }, payload: {} })).statusCode).toBe(403);
    mocks.decide.mockRejectedValue(new Error('TRIAGE_ALREADY_DECIDED'));
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/triage/${id}/decide`, headers: { 'x-client-key': 'valid-key' }, payload: {} })).statusCode).toBe(409);
    await app.close();
  });
  it('searches topics and lists work types behind authentication', async () => {
    const app = server();
    mocks.searchTopics.mockResolvedValue([{ procedureId: 'p1', header: { title: 'A｜段取り', identifiers: {} }, parts: { target: 'A', workType: '段取り' } }]);
    expect((await app.inject({ url: '/hermes-knowledge/procedure-topics?q=A' })).statusCode).toBe(401);
    const topics = await app.inject({ url: '/hermes-knowledge/procedure-topics?q=A', headers: { 'x-client-key': 'valid-key' } });
    expect(topics.json()).toEqual({ topics: [{ procedureId: 'p1', title: 'A｜段取り', parts: { target: 'A', workType: '段取り' }, identifiers: {} }] });
    expect(mocks.searchTopics).toHaveBeenCalledWith('A', 30);
    expect((await app.inject({ url: '/hermes-knowledge/work-types', headers: { 'x-client-key': 'valid-key' } })).json()).toEqual({ workTypes: ['段取り', 'その他'] });
    await app.close();
  });
  it('does not expose ingestion routes when the feature is disabled', async () => {
    vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', 'false'); const app = Fastify(); registerHermesKnowledgeRoutes(app);
    expect((await app.inject({ method: 'POST', url: '/hermes-knowledge/intakes', payload: {} })).statusCode).toBe(404); await app.close();
  });
});
