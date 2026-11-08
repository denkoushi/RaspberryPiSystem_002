import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { BusinessHermesConsultationService } from '../../../services/business-hermes/business-hermes-consultation.service.js';
import { registerBusinessHermesRoutes } from '../business-hermes.js';

function createApp() {
  const guide = vi.fn().mockResolvedValue({
    status: 'ready',
    uiRevision: 'r1',
    message: '案内',
    targetKey: 'current-bolt',
    evidence: []
  });
  const listProactiveSuggestions = vi.fn().mockResolvedValue([]);
  const chat = vi.fn().mockResolvedValue({
    status: 'ready',
    message: '根拠を確認しました。',
    evidence: [],
    partNumber: 'PART-1',
    shootingTarget: '切削',
    needsClarification: false,
    clarificationMessage: null
  });
  const requireClientDevice = vi.fn(async (raw: unknown) => {
    if (raw === 'device-a') return { clientKey: 'device-a', clientDevice: { id: 'device-a', apiKey: 'device-a', name: 'A', location: null, statusClientId: null } };
    throw new ApiError(401, 'client key required', undefined, 'CLIENT_KEY_INVALID');
  });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof ApiError ? error.statusCode : error instanceof ZodError ? 400 : 500;
    void reply.status(statusCode).send({ code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR' });
  });
  return {
    app,
    guide,
    listProactiveSuggestions,
    chat,
    requireClientDevice,
    service: { guide, listProactiveSuggestions } as never,
    chatService: { chat } as never
  };
}

describe('business Hermes routes', () => {
  beforeEach(() => {
    vi.spyOn(prisma.user, 'findUnique').mockImplementation(async ({ where }) => ({
      id: where.id, username: where.id, role: where.id === 'admin' ? 'ADMIN' : where.id === 'viewer' ? 'VIEWER' : 'MANAGER', status: 'ACTIVE', mfaEnabled: false
    }) as never);
  });
  afterEach(() => vi.restoreAllMocks());
  it('requires a client key and passes server-resolved device identity', async () => {
    const fixture = createApp();
    await registerBusinessHermesRoutes(fixture.app, { requireClientDevice: fixture.requireClientDevice, service: fixture.service });

    const noKey = await fixture.app.inject({ method: 'POST', url: '/assembly/work-sessions/00000000-0000-0000-0000-000000000001/hermes-guide', payload: { uiRevision: 'r1', eventCode: 'USER_REQUEST' } });
    expect(noKey.statusCode).toBe(401);

    const ok = await fixture.app.inject({
      method: 'POST',
      url: '/assembly/work-sessions/00000000-0000-0000-0000-000000000001/hermes-guide',
      headers: { 'x-client-key': 'device-a' },
      payload: { uiRevision: 'r1', eventCode: 'USER_REQUEST' }
    });
    expect(ok.statusCode).toBe(200);
    expect(fixture.guide).toHaveBeenCalledWith(expect.objectContaining({ clientDeviceId: 'device-a' }));
  });

  it('allows proactive suggestions to ADMIN only', async () => {
    const fixture = createApp();
    await registerBusinessHermesRoutes(fixture.app, { requireClientDevice: fixture.requireClientDevice, service: fixture.service });
    const managerToken = jwt.sign({ sub: 'manager', username: 'manager', role: 'MANAGER' }, env.JWT_ACCESS_SECRET);
    const adminToken = jwt.sign({ sub: 'admin', username: 'admin', role: 'ADMIN' }, env.JWT_ACCESS_SECRET);

    const unauthenticated = await fixture.app.inject({ method: 'GET', url: '/assembly/business-hermes/proactive-suggestions' });
    expect(unauthenticated.statusCode).toBe(401);
    const manager = await fixture.app.inject({ method: 'GET', url: '/assembly/business-hermes/proactive-suggestions', headers: { authorization: `Bearer ${managerToken}` } });
    expect(manager.statusCode).toBe(403);
    const admin = await fixture.app.inject({ method: 'GET', url: '/assembly/business-hermes/proactive-suggestions', headers: { authorization: `Bearer ${adminToken}` } });
    expect(admin.statusCode).toBe(200);
  });

  it('allows the operator chat through the existing JWT read boundary', async () => {
    const fixture = createApp();
    await registerBusinessHermesRoutes(fixture.app, {
      requireClientDevice: fixture.requireClientDevice,
      service: fixture.service,
      chatService: fixture.chatService
    });
    const managerToken = jwt.sign({ sub: 'manager', username: 'manager', role: 'MANAGER' }, env.JWT_ACCESS_SECRET);

    const unauthenticated = await fixture.app.inject({
      method: 'POST',
      url: '/assembly/business-hermes/chat',
      payload: { messages: [{ role: 'user', content: '品番: PART-1' }] }
    });
    expect(unauthenticated.statusCode).toBe(401);

    const response = await fixture.app.inject({
      method: 'POST',
      url: '/assembly/business-hermes/chat',
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        scope: 'both',
        partNumber: 'PART-1',
        shootingTarget: '切削',
        messages: [{ role: 'user', content: '不適合と要領書を確認してください。' }]
      }
    });
    expect(response.statusCode).toBe(200);
    expect(fixture.chat).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'both',
      partNumber: 'PART-1',
      shootingTarget: '切削'
    }));
  });

  it('exposes independent consultation list/create/detail/update through the same read boundary', async () => {
    const fixture = createApp();
    const consultation = {
      id: '00000000-0000-0000-0000-000000000010', title: '相談', relatedIdentifiers: [], confirmedFacts: [], openQuestions: [], summary: '', updatedAt: new Date().toISOString(), messages: []
    };
    const consultationService = {
      list: vi.fn().mockResolvedValue([consultation]),
      create: vi.fn().mockResolvedValue(consultation),
      get: vi.fn().mockResolvedValue(consultation),
      update: vi.fn().mockResolvedValue(consultation),
      chat: vi.fn(),
      cancel: vi.fn().mockResolvedValue(true),
      feedback: vi.fn().mockResolvedValue(true)
    };
    await registerBusinessHermesRoutes(fixture.app, {
      requireClientDevice: fixture.requireClientDevice,
      service: fixture.service,
      chatService: fixture.chatService,
      consultationService: consultationService as never
    });
    const token = jwt.sign({ sub: 'manager', username: 'manager', role: 'MANAGER' }, env.JWT_ACCESS_SECRET);
    const headers = { authorization: `Bearer ${token}` };
    const listResponse = await fixture.app.inject({ method: 'GET', url: '/assembly/business-hermes/consultations', headers });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({ consultations: [consultation], enabled: true });
    expect((await fixture.app.inject({ method: 'POST', url: '/assembly/business-hermes/consultations', headers, payload: { title: '相談' } })).statusCode).toBe(200);
    expect((await fixture.app.inject({ method: 'GET', url: `/assembly/business-hermes/consultations/${consultation.id}`, headers })).statusCode).toBe(200);
    expect((await fixture.app.inject({ method: 'PATCH', url: `/assembly/business-hermes/consultations/${consultation.id}`, headers, payload: { relatedIdentifiers: ['PN-1'] } })).statusCode).toBe(200);
    expect(consultationService.update).toHaveBeenCalledWith(consultation.id, { relatedIdentifiers: ['PN-1'] }, { kind: 'user', userId: 'manager', role: 'MANAGER' });
    expect((await fixture.app.inject({ method: 'POST', url: `/assembly/business-hermes/consultations/${consultation.id}/cancel`, headers })).json()).toEqual({ cancelled: true });
    expect(consultationService.cancel).toHaveBeenCalledWith(consultation.id, { kind: 'user', userId: 'manager', role: 'MANAGER' });
    const feedbackUrl = `/assembly/business-hermes/consultations/${consultation.id}/feedback`;
    const feedbackBody = { messageId: '00000000-0000-0000-0000-000000000020', verdict: 'helpful' };
    expect((await fixture.app.inject({ method: 'POST', url: feedbackUrl, payload: feedbackBody })).statusCode).toBe(401);
    expect(consultationService.feedback).not.toHaveBeenCalled();
    expect((await fixture.app.inject({ method: 'POST', url: feedbackUrl, headers, payload: feedbackBody })).statusCode).toBe(200);
    expect(consultationService.feedback).toHaveBeenCalledWith(consultation.id, feedbackBody.messageId, 'helpful', { kind: 'user', userId: 'manager', role: 'MANAGER' });
    expect((await fixture.app.inject({ method: 'POST', url: feedbackUrl, headers, payload: { ...feedbackBody, answer: '偽の回答' } })).statusCode).toBe(400);
    consultationService.feedback.mockResolvedValue(false);
    expect((await fixture.app.inject({ method: 'POST', url: feedbackUrl, headers, payload: feedbackBody })).statusCode).toBe(409);

    expect((await fixture.app.inject({ method: 'POST', url: `/assembly/business-hermes/consultations/${consultation.id}/cancel` })).statusCode).toBe(401);
  });

  it('lets VIEWER read consultations but not change them', async () => {
    const fixture = createApp();
    const consultationService = {
      list: vi.fn().mockResolvedValue([]), create: vi.fn(), get: vi.fn(), update: vi.fn(), chat: vi.fn(), cancel: vi.fn(), feedback: vi.fn()
    };
    await registerBusinessHermesRoutes(fixture.app, {
      requireClientDevice: fixture.requireClientDevice,
      service: fixture.service,
      chatService: fixture.chatService,
      consultationService: consultationService as never
    });
    const token = jwt.sign({ sub: 'viewer', username: 'viewer', role: 'VIEWER' }, env.JWT_ACCESS_SECRET);
    const headers = { authorization: `Bearer ${token}` };
    const id = '00000000-0000-4000-8000-000000000001';
    expect((await fixture.app.inject({ method: 'GET', url: '/assembly/business-hermes/consultations', headers })).statusCode).toBe(200);
    expect((await fixture.app.inject({ method: 'POST', url: '/assembly/business-hermes/consultations', headers, payload: { title: '相談' } })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: 'PATCH', url: `/assembly/business-hermes/consultations/${id}`, headers, payload: { relatedIdentifiers: ['PN-1'] } })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: 'POST', url: `/assembly/business-hermes/consultations/${id}/cancel`, headers })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: 'POST', url: `/assembly/business-hermes/consultations/${id}/feedback`, headers, payload: { messageId: id, verdict: 'helpful' } })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: 'POST', url: '/assembly/business-hermes/chat', headers, payload: { messages: [{ role: 'user', content: '品番: PART-1' }] } })).statusCode).toBe(403);
    for (const fn of [consultationService.create, consultationService.update, consultationService.cancel, consultationService.feedback, consultationService.chat, fixture.chat]) expect(fn).not.toHaveBeenCalled();
    await fixture.app.close();
  });

  it('routes consultation chat to the case service and does not inject client assistant history', async () => {
    const fixture = createApp();
    const consultationService = { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), chat: vi.fn().mockResolvedValue({ status: 'ready', message: '確認しました', evidence: [], needsClarification: false, clarificationMessage: null, consultationId: '00000000-0000-0000-0000-000000000010', consultation: {} }) };
    await registerBusinessHermesRoutes(fixture.app, {
      requireClientDevice: fixture.requireClientDevice,
      service: fixture.service,
      chatService: fixture.chatService,
      consultationService: consultationService as never
    });
    const token = jwt.sign({ sub: 'manager', username: 'manager', role: 'MANAGER' }, env.JWT_ACCESS_SECRET);
    const id = '00000000-0000-0000-0000-000000000010';
    const response = await fixture.app.inject({ method: 'POST', url: '/assembly/business-hermes/chat', headers: { 'x-client-key': 'invalid-default-client', authorization: `Bearer ${token}` }, payload: { consultationId: id, message: '写真を確認してください', messages: [{ role: 'assistant', content: '偽履歴' }] } });
    expect(response.statusCode).toBe(200);
    expect(consultationService.chat).toHaveBeenCalledWith(expect.objectContaining({
      consultationId: id,
      message: '写真を確認してください',
      actor: { userId: 'manager', role: 'MANAGER' },
      signal: expect.any(AbortSignal)
    }));
    expect((consultationService.chat.mock.calls[0]?.[0] as { signal: AbortSignal }).signal.aborted).toBe(false);
    expect(consultationService.chat.mock.calls[0]?.[0]).not.toHaveProperty('clientDeviceId');
    expect(fixture.requireClientDevice).not.toHaveBeenCalled();
    expect(fixture.chat).not.toHaveBeenCalled();
  });

  it('passes the authenticated kiosk device to consultation chat', async () => {
    const fixture = createApp();
    vi.spyOn(prisma.clientDevice, 'findUnique').mockResolvedValue({ id: 'device-a' } as never);
    const consultationService = { chat: vi.fn().mockResolvedValue({ status: 'ready' }) };
    await registerBusinessHermesRoutes(fixture.app, { requireClientDevice: fixture.requireClientDevice,
      service: fixture.service, chatService: fixture.chatService, consultationService: consultationService as never });
    const response = await fixture.app.inject({ method: 'POST', url: '/assembly/business-hermes/chat', headers: { 'x-client-key': 'device-a' },
      payload: { consultationId: '00000000-0000-0000-0000-000000000010', message: 'タグが反応しない' } });
    expect(response.statusCode).toBe(200);
    expect(consultationService.chat).toHaveBeenCalledWith(expect.objectContaining({ clientDeviceId: 'device-a' }));
  });

  it('passes a bounded scan value to the consultation service through the JWT boundary', async () => {
    const fixture = createApp();
    const id = '00000000-0000-0000-0000-000000000010';
    const consultationService = {
      list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(),
      chat: vi.fn().mockResolvedValue({ status: 'ready', message: '照合しました', evidence: [], needsClarification: false, clarificationMessage: null, consultationId: id, consultation: {} }),
      cancel: vi.fn()
    };
    await registerBusinessHermesRoutes(fixture.app, {
      requireClientDevice: fixture.requireClientDevice,
      service: fixture.service,
      chatService: fixture.chatService,
      consultationService: consultationService as never
    });
    const token = jwt.sign({ sub: 'manager', username: 'manager', role: 'MANAGER' }, env.JWT_ACCESS_SECRET);
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/assembly/business-hermes/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { consultationId: id, message: 'バーコードの照合結果を確認してください。', scanValue: 'ORDER-SCAN-1' }
    });

    expect(response.statusCode).toBe(200);
    expect(consultationService.chat).toHaveBeenCalledWith(expect.objectContaining({ consultationId: id, scanValue: 'ORDER-SCAN-1' }));

    consultationService.chat.mockClear();
    const tooLong = await fixture.app.inject({
      method: 'POST',
      url: '/assembly/business-hermes/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { consultationId: id, message: 'バーコードの照合結果を確認してください。', scanValue: 'x'.repeat(501) }
    });
    expect(tooLong.statusCode).not.toBe(200);
    expect(consultationService.chat).not.toHaveBeenCalled();
  });
  async function ownerFixture(owner: 'user' | 'device' | 'legacy' = 'user') {
    const fixture = createApp();
    const row = {
      id: '00000000-0000-0000-0000-000000000010', title: '相談',
      createdByUserId: owner === 'user' ? 'manager' : null,
      createdByClientDeviceId: owner === 'device' ? 'device-a' : null,
      relatedIdentifiers: [], confirmedFacts: [], openQuestions: [], summary: null,
      updatedAt: new Date(), messages: []
    };
    const db = { businessHermesConsultation: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === row.id ? row : null),
      findMany: vi.fn().mockResolvedValue([row]),
      update: vi.fn(async ({ data }: { data: object }) => Object.assign(row, data)),
      create: vi.fn(async ({ data }: { data: object }) => Object.assign(row, data))
    }, businessHermesConsultationMessage: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } };
    const fetchImpl = vi.fn();
    const service = new BusinessHermesConsultationService({ db: db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'test', model: 'chat' } });
    fixture.requireClientDevice.mockImplementation(async (raw: unknown) => ({
      clientKey: String(raw), clientDevice: { id: String(raw), apiKey: String(raw), name: '端末', location: null, statusClientId: null }
    }));
    vi.spyOn(prisma.clientDevice, 'findUnique').mockImplementation(async ({ where }) => ({ id: where.apiKey, canProxyOtherDevices: true }) as never);
    await registerBusinessHermesRoutes(fixture.app, { requireClientDevice: fixture.requireClientDevice,
      service: fixture.service, chatService: fixture.chatService, consultationService: service });
    return { ...fixture, row, db, fetchImpl };
  }

  function callerHeaders(caller: string) {
    return caller.startsWith('device-') ? { 'x-client-key': caller } : {
      authorization: `Bearer ${jwt.sign({ sub: caller, username: caller, role: caller === 'admin' ? 'ADMIN' : 'MANAGER' }, env.JWT_ACCESS_SECRET)}`,
      'x-client-key': 'device-a'
    };
  }

  it.each([
    ['user', 'manager', 200], ['user', 'other-manager', 403], ['user', 'admin', 200],
    ['user', 'device-a', 403], ['device', 'device-a', 200], ['device', 'device-b', 403],
    ['device', 'manager', 403], ['device', 'admin', 200],
    ['legacy', 'manager', 200], ['legacy', 'admin', 200], ['legacy', 'device-a', 403]
  ] as const)('checks PATCH for %s consultation and %s (%s)', async (owner, caller, status) => {
    const fixture = await ownerFixture(owner);
    try {
      const response = await fixture.app.inject({ method: 'PATCH', url: `/assembly/business-hermes/consultations/${fixture.row.id}`,
        headers: callerHeaders(caller), payload: { title: '更新' } });
      expect(response.statusCode).toBe(status);
      if (status === 403) {
        expect(response.json().code).toBe('BUSINESS_HERMES_CONSULTATION_NOT_OWNER');
        expect(fixture.db.businessHermesConsultation.update).not.toHaveBeenCalled();
      } else expect(fixture.row.title).toBe('更新');
    } finally { await fixture.app.close(); }
  });

  it.each(['cancel', 'feedback', 'chat'] as const)('rejects another manager for %s before side effects', async (operation) => {
    const fixture = await ownerFixture();
    try {
      const response = await fixture.app.inject({ method: 'POST',
        url: operation === 'chat' ? '/assembly/business-hermes/chat' : `/assembly/business-hermes/consultations/${fixture.row.id}/${operation}`,
        headers: callerHeaders('other-manager'),
        payload: operation === 'chat' ? { consultationId: fixture.row.id, message: '追加の質問' }
          : operation === 'feedback' ? { messageId: fixture.row.id, verdict: 'helpful' } : {} });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('BUSINESS_HERMES_CONSULTATION_NOT_OWNER');
      expect(fixture.fetchImpl).not.toHaveBeenCalled();
      expect(fixture.db.businessHermesConsultationMessage.create).not.toHaveBeenCalled();
      expect(fixture.db.businessHermesConsultationMessage.update).not.toHaveBeenCalled();
      expect(fixture.row.messages).toHaveLength(0);
    } finally { await fixture.app.close(); }
  });

  it.each(['other-manager', 'device-b'])('keeps list and detail shared with %s', async (caller) => {
    const fixture = await ownerFixture();
    try {
      for (const suffix of ['', `/${fixture.row.id}`]) {
        const response = await fixture.app.inject({ method: 'GET', url: `/assembly/business-hermes/consultations${suffix}`, headers: callerHeaders(caller) });
        expect(response.statusCode).toBe(200);
        expect(response.body).not.toContain('createdBy');
      }
    } finally { await fixture.app.close(); }
  });

  it.each(['device-a', 'manager'])('records the creator on POST for %s', async (caller) => {
    const fixture = await ownerFixture('legacy');
    try {
      const response = await fixture.app.inject({ method: 'POST', url: '/assembly/business-hermes/consultations', headers: callerHeaders(caller), payload: {} });
      expect(response.statusCode).toBe(200);
      expect(fixture.db.businessHermesConsultation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        createdByUserId: caller === 'manager' ? 'manager' : null,
        createdByClientDeviceId: caller === 'device-a' ? 'device-a' : null
      }) }));
    } finally { await fixture.app.close(); }
  });

  it('preserves missing consultation results', async () => {
    const fixture = await ownerFixture();
    const id = '00000000-0000-0000-0000-000000000099';
    const headers = callerHeaders('other-manager');
    try {
      expect((await fixture.app.inject({ method: 'PATCH', url: `/assembly/business-hermes/consultations/${id}`, headers, payload: {} })).statusCode).toBe(404);
      expect((await fixture.app.inject({ method: 'POST', url: `/assembly/business-hermes/consultations/${id}/cancel`, headers })).json()).toEqual({ cancelled: false });
      expect((await fixture.app.inject({ method: 'POST', url: `/assembly/business-hermes/consultations/${id}/feedback`, headers, payload: { messageId: id, verdict: 'helpful' } })).statusCode).toBe(409);
      const response = await fixture.app.inject({ method: 'POST', url: '/assembly/business-hermes/chat', headers, payload: { consultationId: id, message: '質問' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_CONSULTATION_NOT_FOUND' });
    } finally { await fixture.app.close(); }
  });

});
