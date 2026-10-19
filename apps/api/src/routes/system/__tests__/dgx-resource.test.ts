import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../../services/clients/error-log-device.service.js', () => ({ resolveErrorLogDevice: async () => ({}) }));
vi.mock('../../../services/inference/inference-runtime.js', () => ({ getInferenceRuntime: vi.fn() }));
vi.mock('../../../services/system/dgx-resource/dgx-resource.service.js', () => ({ createDgxResourceService: vi.fn() }));

import { env } from '../../../config/env.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { createDgxResourceService } from '../../../services/system/dgx-resource/dgx-resource.service.js';
import { registerDgxResourceRoutes } from '../dgx-resource.js';

let app: FastifyInstance;
const action = vi.fn(async () => ({ ok: true as const, message: '完了しました' }));
const headers = (role = 'ADMIN') => ({ authorization: `Bearer ${jwt.sign({ sub: 'test', username: 'test', role }, env.JWT_ACCESS_SECRET)}` });
beforeEach(async () => {
  action.mockClear();
  vi.mocked(createDgxResourceService).mockReturnValue({ executeAction: action, getEvents: () => [], getOverview: vi.fn(async () => ({})) as never });
  app = Fastify();
  registerErrorHandler(app);
  registerDgxResourceRoutes(app);
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('DGX resource routes', () => {
  it.each([
    { type: 'RETURN_TO_BUSINESS', modelProfileId: 'model-a' },
    { type: 'STOP_BUSINESS_LLM' },
    { type: 'PREVIEW_MODEL_STORAGE_DELETE', modelProfileId: 'model-a' },
    { type: 'EXECUTE_MODEL_STORAGE_DELETE', modelProfileId: 'model-a', planFingerprint: 'a'.repeat(64), confirmation: 'DELETE model-a' },
  ])('accepts $type', async (payload) => {
    const response = await app.inject({ method: 'POST', url: '/system/dgx-resource/actions', headers: headers(), payload });
    expect(response.statusCode).toBe(200);
    expect(action).toHaveBeenCalledWith(payload);
  });
  it.each([
    'SET_POLICY', 'EXECUTE_TARGET_ACTION', 'LOCAL_LLM_START', 'LOCAL_LLM_STOP', 'START_MODEL_PROFILE',
    'PREVIEW_ORCHESTRATION_SCENARIO', 'EXECUTE_ORCHESTRATION_SCENARIO', 'RELEASE_DGX_RESOURCES', 'UNKNOWN',
  ])('rejects removed or unknown action %s', async (type) => {
    const response = await app.inject({ method: 'POST', url: '/system/dgx-resource/actions', headers: headers(), payload: { type } });
    expect(response.statusCode).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });
  it.each([
    { type: 'RETURN_TO_BUSINESS' },
    { type: 'RETURN_TO_BUSINESS', modelProfileId: '../path' },
    { type: 'EXECUTE_MODEL_STORAGE_DELETE', modelProfileId: 'a', planFingerprint: 'short', confirmation: 'a' },
    { type: 'EXECUTE_MODEL_STORAGE_DELETE', modelProfileId: 'a', planFingerprint: 'f'.repeat(64), confirmation: '' },
  ])('rejects invalid payload %j', async (payload) => {
    const response = await app.inject({ method: 'POST', url: '/system/dgx-resource/actions', headers: headers(), payload });
    expect(response.statusCode).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'MANAGER'])('allows %s to read overview and events', async (role) => {
    for (const path of ['overview', 'events']) {
      expect((await app.inject({ url: `/system/dgx-resource/${path}`, headers: headers(role) })).statusCode).toBe(200);
    }
  });
  it.each(['overview', 'events', 'actions'])('rejects VIEWER on %s', async (path) => {
    expect((await app.inject({ method: path === 'actions' ? 'POST' : 'GET', url: `/system/dgx-resource/${path}`, headers: headers('VIEWER'),
      ...(path === 'actions' ? { payload: { type: 'STOP_BUSINESS_LLM' } } : {}) })).statusCode).toBe(403);
  });
  it('rejects unauthenticated requests', async () => {
    expect((await app.inject({ url: '/system/dgx-resource/overview' })).statusCode).toBe(401);
  });
});
