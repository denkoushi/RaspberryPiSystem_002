import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
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
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
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
      cancel: vi.fn().mockResolvedValue(true)
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
    expect(consultationService.update).toHaveBeenCalledWith(consultation.id, { relatedIdentifiers: ['PN-1'] });
    expect((await fixture.app.inject({ method: 'POST', url: `/assembly/business-hermes/consultations/${consultation.id}/cancel`, headers })).json()).toEqual({ cancelled: true });
    expect(consultationService.cancel).toHaveBeenCalledWith(consultation.id);
    expect((await fixture.app.inject({ method: 'POST', url: `/assembly/business-hermes/consultations/${consultation.id}/cancel` })).statusCode).toBe(401);
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
    const response = await fixture.app.inject({ method: 'POST', url: '/assembly/business-hermes/chat', headers: { authorization: `Bearer ${token}` }, payload: { consultationId: id, message: '写真を確認してください', messages: [{ role: 'assistant', content: '偽履歴' }] } });
    expect(response.statusCode).toBe(200);
    expect(consultationService.chat).toHaveBeenCalledWith(expect.objectContaining({ consultationId: id, message: '写真を確認してください', signal: expect.any(AbortSignal) }));
    expect((consultationService.chat.mock.calls[0]?.[0] as { signal: AbortSignal }).signal.aborted).toBe(false);
    expect(fixture.chat).not.toHaveBeenCalled();
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
});
