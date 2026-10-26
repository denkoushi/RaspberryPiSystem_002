import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { registerErrorHandler } from '../error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError, DomainHttpError } from '../../lib/errors.js';
vi.mock('../../lib/prisma.js', () => ({ prisma: { clientDevice: { findUnique: vi.fn() } } }));

afterEach(() => vi.restoreAllMocks());
describe('error handler device enrichment', () => {
  async function app() {
    const instance = Fastify();
    registerErrorHandler(instance);
    instance.get('/fail', async () => { throw new ApiError(503, 'same failure', undefined, 'SAME_FAILURE'); });
    return instance;
  }
  it('returns the same response when device lookup fails', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockRejectedValue(new Error('DB unavailable'));
    const instance = await app();
    const baseline = await instance.inject('/fail');
    const response = await instance.inject({ url: '/fail', headers: { 'x-client-key': 'failing-key' } });
    expect(response.statusCode).toBe(baseline.statusCode);
    expect(response.json()).toMatchObject({ message: baseline.json().message, errorCode: baseline.json().errorCode });
    expect(response.json()).not.toHaveProperty('clientDeviceId');
    await instance.close();
  });
  it('does not await a hanging DB and logs identity without key or hash', async () => {
    const instance = await app();
    await instance.ready();
    vi.useFakeTimers();
    vi.mocked(prisma.clientDevice.findUnique).mockReturnValue(new Promise(() => undefined));
    const response = await instance.inject({ url: '/fail', headers: { 'x-client-key': 'hanging-key' } });
    expect(response.statusCode).toBe(503); // No timer advanced: lookup cannot delay the response.
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    await instance.close();
  });
  it('enriches logs with selected device fields and caches lookups', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'dev-1', name: '組立端末', statusClientId: 'pi4-1' } as never);
    const logs: unknown[] = [];
    const instance = Fastify({ logger: { stream: { write: (line: string) => { logs.push(JSON.parse(line)); } } } });
    registerErrorHandler(instance);
    instance.get('/fail', async () => { throw new Error('broken'); });
    const initialCalls = vi.mocked(prisma.clientDevice.findUnique).mock.calls.length;
    for (let i = 0; i < 2; i++) await instance.inject({ url: '/fail', headers: { 'x-client-key': 'unique-cache-key' } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledTimes(initialCalls + 1);
    expect(logs).toContainEqual(expect.objectContaining({ clientDeviceId: 'dev-1', clientDeviceName: '組立端末', statusClientId: 'pi4-1' }));
    expect(JSON.stringify(logs)).not.toContain('unique-cache-key');
    await instance.close();
  });
  it('uses already resolved request device information without querying', async () => {
    const { resolveErrorLogDevice } = await import('../../services/clients/error-log-device.service.js');
    const calls = vi.mocked(prisma.clientDevice.findUnique).mock.calls.length;
    expect(await resolveErrorLogDevice({ clientDevice: { id: 'resolved', name: '端末', statusClientId: 'pi4' }, headers: { 'x-client-key': 'unused' } } as never)).toEqual({ clientDeviceId: 'resolved', clientDeviceName: '端末', statusClientId: 'pi4' });
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledTimes(calls);
  });
});

describe('domain HTTP errors', () => {
  it.each([
    { code: 'DOMAIN_CONFLICT', details: { expectedVersion: 1 } },
    { code: undefined, details: undefined }
  ])('matches the equivalent ApiError response: $code', async ({ code, details }) => {
    const instance = Fastify({ genReqId: () => 'same-request' });
    registerErrorHandler(instance);
    const domainError = new DomainHttpError(409, 'same conflict', code, details);
    expect(domainError).not.toBeInstanceOf(ApiError);
    instance.get('/domain', async () => { throw domainError; });
    instance.get('/api', async () => { throw new ApiError(409, 'same conflict', details, code); });
    await instance.ready();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const domain = await instance.inject('/domain');
      const api = await instance.inject('/api');
      expect(domain.statusCode).toBe(409);
      expect(domain.statusCode).toBe(api.statusCode);
      expect(domain.json()).toEqual(api.json());
      expect(domain.json()).toEqual({
        message: 'same conflict',
        requestId: 'same-request',
        timestamp: new Date().toISOString(),
        ...(code ? { errorCode: code } : {}),
        ...(details !== undefined ? { details } : {})
      });
    } finally {
      vi.useRealTimers();
      await instance.close();
    }
  });
});

describe('Prisma record not found (P2025)', () => {
  async function app(error: unknown) {
    const instance = Fastify({ genReqId: () => 'not-found-request' });
    registerErrorHandler(instance);
    instance.put('/items/:id', async () => { throw error; });
    await instance.ready();
    return instance;
  }

  it.each([
    {
      name: 'PrismaClientKnownRequestError',
      error: new PrismaClientKnownRequestError('Record to update not found.', {
        code: 'P2025',
        clientVersion: 'test',
        meta: { modelName: 'Item', cause: 'Record to update not found.' }
      })
    },
    {
      name: 'Prisma-like error from another runtime',
      error: Object.assign(new Error('Record to delete does not exist.'), { code: 'P2025', meta: { modelName: 'Item' } })
    }
  ])('answers 404 instead of 400: $name', async ({ error }) => {
    const instance = await app(error);
    try {
      const res = await instance.inject({ method: 'PUT', url: '/items/missing' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        message: expect.stringContaining('対象のデータが見つかりません'),
        requestId: 'not-found-request',
        errorCode: 'P2025',
        details: { modelName: 'Item' }
      });
    } finally {
      await instance.close();
    }
  });

  it('keeps other Prisma errors at 400', async () => {
    const instance = await app(new PrismaClientKnownRequestError('Value too long.', { code: 'P2000', clientVersion: 'test' }));
    try {
      const res = await instance.inject({ method: 'PUT', url: '/items/x' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ errorCode: 'P2000' });
    } finally {
      await instance.close();
    }
  });
});
