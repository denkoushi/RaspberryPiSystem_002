import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
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
