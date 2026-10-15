import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { registerProcedureMaterialRoutes } from '../procedure-materials.js';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
const url = '/assembly/procedure-materials/split-suggestions';
describe('split suggestion route', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); });
  async function harness(deny = false) {
    app = Fastify(); registerErrorHandler(app); await app.register(rateLimit);
    const suggest = vi.fn().mockResolvedValue({ status: 'ok', boundaries: [{ beforeId: ids[1], afterId: ids[0], probability: 0.8 }] });
    registerProcedureMaterialRoutes(app, { splitSuggestions: { suggest }, semanticSearch: { rank: vi.fn() },
      allowView: async () => { if (deny) throw new ApiError(403, 'denied'); },
      allowWriteKiosk: async () => { throw new Error('write permission must not be used'); } });
    return suggest;
  }
  it('accepts ordered ids with view permission and returns the injected result', async () => {
    const suggest = await harness();
    const result = await app.inject({ method: 'POST', url, payload: { ids } });
    expect(result.statusCode).toBe(200); expect(suggest).toHaveBeenCalledExactlyOnceWith(ids);
    expect(result.json().boundaries[0]).toMatchObject({ beforeId: ids[1], afterId: ids[0] });
  });
  it.each([{}, { ids: [] }, { ids: [ids[0]] }, { ids: [...ids, 'invalid'] }, { ids: Array(61).fill(ids[0]) }, { ids, model: 'client-model' }])('rejects invalid strict body %j', async payload => {
    const suggest = await harness();
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });
  it('accepts 60 ids', async () => {
    const suggest = await harness(); const many = Array(60).fill(ids[0]);
    expect((await app.inject({ method: 'POST', url, payload: { ids: many } })).statusCode).toBe(200);
    expect(suggest).toHaveBeenCalledWith(many);
  });
  it('checks view permission first', async () => {
    const suggest = await harness(true);
    expect((await app.inject({ method: 'POST', url, payload: { ids } })).statusCode).toBe(403);
    expect(suggest).not.toHaveBeenCalled();
  });
  it('limits calls to 30 per minute', async () => {
    const suggest = await harness();
    for (let i = 0; i < 30; i++) expect((await app.inject({ method: 'POST', url, payload: { ids } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, payload: { ids } })).statusCode).toBe(429);
    expect(suggest).toHaveBeenCalledTimes(30);
  });
});
