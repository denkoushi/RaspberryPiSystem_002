import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerHermesKnowledgeRoutes } from '../hermes-knowledge.js';

const mocks = vi.hoisted(() => ({
  receive: vi.fn(), choose: vi.fn(), readySources: vi.fn(), get: vi.fn(), kick: vi.fn(),
  readDisplay: vi.fn(),
}));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  parseKioskApiClientKeyHeader: (value: unknown) => typeof value === 'string' ? value : undefined,
  findClientDeviceByApiKey: async (key: string) => key === 'valid-key' ? { id: 'device-one' } : null,
}));
vi.mock('../../services/knowledge/knowledge-runtime.js', () => ({
  getKnowledgeRuntime: () => ({ intake: { receive: mocks.receive }, repository: { choose: mocks.choose, readySources: mocks.readySources, get: mocks.get },
    assets: { readDisplay: mocks.readDisplay }, worker: { kick: mocks.kick, stop: async () => {} }, documents: { initialize: async () => {} } }),
}));

describe('Knowledge API authentication boundary', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
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
  it('does not expose ingestion routes when the feature is disabled', async () => {
    vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', 'false'); const app = Fastify(); registerHermesKnowledgeRoutes(app);
    expect((await app.inject({ method: 'POST', url: '/hermes-knowledge/intakes', payload: {} })).statusCode).toBe(404); await app.close();
  });
});
