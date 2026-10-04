import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerHermesKnowledgeRoutes } from '../hermes-knowledge.js';

const mocks = vi.hoisted(() => ({
  receive: vi.fn(), choose: vi.fn(), readySources: vi.fn(), get: vi.fn(), kick: vi.fn(),
  readDisplay: vi.fn(), listPublished: vi.fn(), getPublished: vi.fn(), triageGet: vi.fn().mockResolvedValue([]),
  resolveReviewer: vi.fn(), listRanks: vi.fn(), replaceRanks: vi.fn(),
  listPendingApproval: vi.fn(), getForReview: vi.fn(), approve: vi.fn(), returnRevision: vi.fn(), reportError: vi.fn(),
  pending: vi.fn(), decide: vi.fn(), searchTopics: vi.fn(), procedureKick: vi.fn(),
}));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  parseKioskApiClientKeyHeader: (value: unknown) => typeof value === 'string' ? value : undefined,
  findClientDeviceByApiKey: async (key: string) => key === 'valid-key' ? { id: 'device-one' } : null,
}));
vi.mock('../../services/knowledge/knowledge-runtime.js', () => ({
  getKnowledgeRuntime: () => ({ intake: { receive: mocks.receive }, repository: { choose: mocks.choose, readySources: mocks.readySources, get: mocks.get },
    assets: { readDisplay: mocks.readDisplay }, worker: { kick: mocks.kick, stop: async () => {} }, documents: { initialize: async () => {} },
    procedures: { listPublished: mocks.listPublished, getPublished: mocks.getPublished, searchTopics: mocks.searchTopics, listPendingApproval: mocks.listPendingApproval, getForReview: mocks.getForReview,
      approve: mocks.approve, returnRevision: mocks.returnRevision, reportError: mocks.reportError },
    reviewers: { resolve: mocks.resolveReviewer, listRanks: mocks.listRanks, replaceRanks: mocks.replaceRanks },
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

describe('Knowledge review API', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const headers = { 'x-client-key': 'valid-key' };
  const reviewer = { id: 'e1', employeeCode: '0001', displayName: '社員A', nfcTagUid: 'tag', positionName: '主任', rank: 'leader' };
  const server = () => { vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', 'true'); const app = Fastify(); registerHermesKnowledgeRoutes(app); return app; };
  const jwtHeaders = (role: string) => ({ authorization: `Bearer ${jwt.sign({ sub: 'user-1', username: 'review-admin', role }, process.env.JWT_ACCESS_SECRET!)}` });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); mocks.triageGet.mockResolvedValue([]); });

  it.each(['pending', 'detail', 'approve', 'return'])('requires knowledgeActor for %s', async action => {
    const app = server();
    const response = await app.inject({ method: 'POST', url: action === 'pending' ? '/hermes-knowledge/reviews/pending' : `/hermes-knowledge/reviews/${id}/${action}`,
      payload: { reviewerTagUid: 'tag', ...(action === 'return' ? { comment: '再確認' } : {}) } });
    expect(response.statusCode).toBe(401); expect(mocks.resolveReviewer).not.toHaveBeenCalled(); await app.close();
  });
  it.each(['general', 'unmapped', 'no-position', 'inactive', 'unknown', 'duplicate'])('rejects %s for list, detail, approval and return', async tag => {
    const app = server();
    const code = tag === 'unknown' ? 'KNOWLEDGE_UNKNOWN_EMPLOYEE' : tag === 'inactive' ? 'KNOWLEDGE_INACTIVE_EMPLOYEE'
      : tag === 'duplicate' ? 'KNOWLEDGE_DUPLICATE_TAG' : 'KNOWLEDGE_APPROVAL_FORBIDDEN';
    mocks.resolveReviewer.mockRejectedValue(new Error(code));
    for (const action of ['pending', 'detail', 'approve', 'return']) {
      const response = await app.inject({ method: 'POST', url: action === 'pending' ? '/hermes-knowledge/reviews/pending' : `/hermes-knowledge/reviews/${id}/${action}`,
        headers, payload: { reviewerTagUid: tag, ...(action === 'return' ? { comment: '再確認' } : {}) } });
      expect(response.statusCode).toBe(tag === 'unknown' ? 400 : tag === 'duplicate' ? 409 : 403);
    }
    expect(mocks.listPendingApproval).not.toHaveBeenCalled(); expect(mocks.getForReview).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.returnRevision).not.toHaveBeenCalled(); await app.close();
  });
  it.each(['leader', 'section_chief', 'manager'])('lets %s list, read, approve and return using the device actor', async rank => {
    const app = server(); const employee = { ...reviewer, rank };
    mocks.resolveReviewer.mockResolvedValue(employee); mocks.listPendingApproval.mockResolvedValue([{ revisionId: id }]);
    mocks.getForReview.mockResolvedValue({ revisionId: id, state: 'pending_approval' }); mocks.approve.mockResolvedValue(undefined); mocks.returnRevision.mockResolvedValue(undefined);
    const list = await app.inject({ method: 'POST', url: '/hermes-knowledge/reviews/pending', headers, payload: { reviewerTagUid: 'tag' } });
    expect(list.json()).toEqual({ reviewer: { displayName: '社員A', positionName: '主任', rank }, reviews: [{ revisionId: id }] });
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/reviews/${id}/detail`, headers, payload: { reviewerTagUid: 'tag' } })).json()).toEqual({ procedure: { revisionId: id, state: 'pending_approval' } });
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/reviews/${id}/approve`, headers, payload: { reviewerTagUid: 'tag' } })).json()).toEqual({ ok: true });
    expect(mocks.approve).toHaveBeenCalledWith(id, employee, 'client:device-one', undefined);
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/reviews/${id}/return`, headers, payload: { reviewerTagUid: 'tag', comment: ' 再確認 ' } })).statusCode).toBe(200);
    expect(mocks.returnRevision).toHaveBeenCalledWith(id, employee, 'client:device-one', '再確認'); await app.close();
  });
  it('returns the latest error-report comment in the pending list', async () => {
    const app = server(); mocks.resolveReviewer.mockResolvedValue(reviewer);
    mocks.listPendingApproval.mockResolvedValue([{ revisionId: id, reportComment: '締切を再確認' }]);
    const response = await app.inject({ method: 'POST', url: '/hermes-knowledge/reviews/pending', headers, payload: { reviewerTagUid: 'tag' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().reviews).toEqual([{ revisionId: id, reportComment: '締切を再確認' }]);
    await app.close();
  });
  it('rejects missing/blank/oversized comments and extra fields', async () => {
    const app = server(); mocks.resolveReviewer.mockResolvedValue(reviewer);
    for (const body of [{ reviewerTagUid: 'tag' }, { reviewerTagUid: 'tag', comment: ' ' }, { reviewerTagUid: 'tag', comment: 'a'.repeat(501) }, { reviewerTagUid: 'tag', comment: 'ok', rank: 'manager' }]) {
      expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/reviews/${id}/return`, headers, payload: body })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/procedures/${id}/error-report`, headers, payload: { reporterTagUid: 'tag' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/hermes-knowledge/reviews/pending', headers, payload: { reviewerTagUid: 'tag', extra: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/reviews/${id}/approve`, headers, payload: { reviewerTagUid: 'tag', comment: 'a'.repeat(501) } })).statusCode).toBe(400);
    expect(mocks.returnRevision).not.toHaveBeenCalled(); await app.close();
  });
  it('reports conflicts and hides revisions outside pending_approval', async () => {
    const app = server(); mocks.resolveReviewer.mockResolvedValue(reviewer); mocks.getForReview.mockResolvedValue(null);
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/reviews/${id}/detail`, headers, payload: { reviewerTagUid: 'tag' } })).statusCode).toBe(404);
    for (const action of ['approve', 'return']) {
      mocks.approve.mockRejectedValue(new Error('PROCEDURE_REVIEW_CONFLICT')); mocks.returnRevision.mockRejectedValue(new Error('PROCEDURE_REVIEW_CONFLICT'));
      expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/reviews/${id}/${action}`, headers, payload: { reviewerTagUid: 'tag', comment: '再確認' } })).statusCode).toBe(409);
    }
    await app.close();
  });
  it('permits active general employees to report errors with a JWT actor', async () => {
    const app = server(); const employee = { ...reviewer, rank: 'general' }; mocks.resolveReviewer.mockResolvedValue(employee); mocks.reportError.mockResolvedValue(undefined);
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/procedures/${id}/error-report`, headers: jwtHeaders('VIEWER'), payload: { reporterTagUid: 'tag', comment: '誤り' } })).statusCode).toBe(200);
    expect(mocks.resolveReviewer).toHaveBeenCalledWith('tag'); expect(mocks.reportError).toHaveBeenCalledWith(id, employee, 'user:user-1', '誤り');
    mocks.reportError.mockRejectedValue(new Error('PROCEDURE_NOT_PUBLISHED'));
    expect((await app.inject({ method: 'POST', url: `/hermes-knowledge/procedures/${id}/error-report`, headers, payload: { reporterTagUid: 'tag', comment: '誤り' } })).statusCode).toBe(409);
    await app.close();
  });
  it('serves only images referenced by a pending revision behind authentication', async () => {
    const app = server(); const image = 'c'.repeat(64); mocks.getForReview.mockResolvedValue({ steps: [{ photos: [{ imageId: image }] }] }); mocks.readDisplay.mockResolvedValue(Buffer.from('jpeg'));
    const url = `/hermes-knowledge/reviews/${id}/images/${image}`;
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers })).statusCode).toBe(200);
    expect((await app.inject({ url: `/hermes-knowledge/reviews/${id}/images/${'d'.repeat(64)}`, headers })).statusCode).toBe(404);
    mocks.getForReview.mockResolvedValue(null); expect((await app.inject({ url, headers })).statusCode).toBe(404);
    expect(mocks.readDisplay).toHaveBeenCalledTimes(1); await app.close();
  });
  it.each(['ADMIN', 'MANAGER'])('allows JWT %s to read and replace mappings', async role => {
    const app = server(); const table = { ranks: [], unmappedPositions: [{ positionName: '主事', employeeCount: 2 }] }; mocks.listRanks.mockResolvedValue(table);
    expect((await app.inject({ url: '/hermes-knowledge/position-ranks', headers: jwtHeaders(role) })).json()).toEqual(table);
    expect((await app.inject({ method: 'PUT', url: '/hermes-knowledge/position-ranks', headers: jwtHeaders(role), payload: { ranks: [{ positionName: '主任', rank: 'leader' }] } })).statusCode).toBe(200);
    expect(mocks.replaceRanks).toHaveBeenCalledWith([{ positionName: '主任', rank: 'leader' }]); await app.close();
  });
  it('denies device keys and VIEWER JWT for mapping reads and writes', async () => {
    const app = server();
    for (const method of ['GET', 'PUT'] as const) for (const auth of [headers, jwtHeaders('VIEWER')]) {
      expect((await app.inject({ method, url: '/hermes-knowledge/position-ranks', headers: auth, ...(method === 'PUT' ? { payload: { ranks: [] } } : {}) })).statusCode).toBe(auth === headers ? 401 : 403);
    }
    expect(mocks.listRanks).not.toHaveBeenCalled(); expect(mocks.replaceRanks).not.toHaveBeenCalled(); await app.close();
  });
  it('rejects duplicate names, unknown ranks, extra fields and more than 200 mappings', async () => {
    const app = server();
    for (const payload of [
      { ranks: [{ positionName: '主任', rank: 'leader' }, { positionName: ' 主任 ', rank: 'general' }] },
      { ranks: [{ positionName: '主任', rank: 'boss' }] }, { ranks: [], extra: 1 },
      { ranks: Array.from({ length: 201 }, (_, index) => ({ positionName: String(index), rank: 'general' })) },
    ]) expect((await app.inject({ method: 'PUT', url: '/hermes-knowledge/position-ranks', headers: jwtHeaders('ADMIN'), payload })).statusCode).toBe(400);
    expect(mocks.replaceRanks).not.toHaveBeenCalled(); await app.close();
  });
});
