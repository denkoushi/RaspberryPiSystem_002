import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeClientKey } from '../../../lib/client-key.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import {
  findClientDeviceByApiKey,
  listClientDevicesForCallTargets,
  listClientStatusesForCallTargets,
} from '../../../services/kiosk/kiosk-call-targets.service.js';
import { registerKioskCallTargetsRoute } from '../call-targets.js';

// Keep error logging off the database: the handler otherwise resolves the device via Prisma.
vi.mock('../../../services/clients/error-log-device.service.js', () => ({ resolveErrorLogDevice: async () => undefined }));
vi.mock('../../../services/kiosk/kiosk-call-targets.service.js', () => ({
  findClientDeviceByApiKey: vi.fn(),
  listClientDevicesForCallTargets: vi.fn(),
  listClientStatusesForCallTargets: vi.fn(),
}));

const now = new Date('2026-11-04T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600_000);
const excluded = new Set<string>();

describe('GET /kiosk/call/targets', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    excluded.clear();
    app = Fastify();
    registerErrorHandler(app);
    await registerKioskCallTargetsRoute(app, { normalizeClientKey, getWebRTCCallExcludeClientIds: () => excluded });
    vi.mocked(findClientDeviceByApiKey).mockImplementation((async (key: string) => (key === 'self-key' ? { id: 'self' } : null)) as never);
    vi.mocked(listClientStatusesForCallTargets).mockResolvedValue([] as never);
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  const call = (headers: Record<string, string> = { 'x-client-key': 'self-key' }) =>
    app.inject({ method: 'GET', url: '/kiosk/call/targets', headers });

  it('requires a client key', async () => {
    const response = await call({});
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ errorCode: 'CLIENT_KEY_REQUIRED' });
    expect(listClientDevicesForCallTargets).not.toHaveBeenCalled();
  });

  it('rejects an unknown client key before listing devices', async () => {
    const response = await call({ 'x-client-key': 'other' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ errorCode: 'INVALID_CLIENT_KEY' });
    expect(listClientDevicesForCallTargets).not.toHaveBeenCalled();
  });

  it('excludes the caller and configured devices and prefers status hostname/IP', async () => {
    excluded.add('signage');
    vi.mocked(listClientStatusesForCallTargets).mockResolvedValue([
      { clientId: 'status-a', hostname: 'pi-a', ipAddress: '10.0.0.5', lastSeen: hoursAgo(1), updatedAt: hoursAgo(1) },
    ] as never);
    vi.mocked(listClientDevicesForCallTargets).mockResolvedValue([
      { id: 'a', name: '組立A', location: '1F', statusClientId: 'status-a', lastSeenAt: null, updatedAt: hoursAgo(100) },
      { id: 'b', name: '倉庫', location: null, statusClientId: null, lastSeenAt: hoursAgo(2), updatedAt: hoursAgo(100) },
      { id: 'self', name: '自分', location: null, statusClientId: null, lastSeenAt: now, updatedAt: now },
      { id: 'signage', name: 'サイネージ', location: null, statusClientId: null, lastSeenAt: now, updatedAt: now },
    ] as never);

    const response = await call();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      selfClientId: 'self',
      targets: [
        { clientId: 'a', hostname: 'pi-a', ipAddress: '10.0.0.5', lastSeen: hoursAgo(1).toISOString(), stale: false, name: '組立A', location: '1F' },
        { clientId: 'b', hostname: '倉庫', ipAddress: 'unknown', lastSeen: hoursAgo(2).toISOString(), stale: false, name: '倉庫', location: null },
      ],
    });
  });

  it('prefers device lastSeenAt over status times and flags devices unseen for more than 12 hours as stale', async () => {
    vi.mocked(listClientStatusesForCallTargets).mockResolvedValue([
      { clientId: 'status-a', hostname: 'pi-a', ipAddress: '10.0.0.5', lastSeen: hoursAgo(1), updatedAt: hoursAgo(1) },
    ] as never);
    vi.mocked(listClientDevicesForCallTargets).mockResolvedValue([
      { id: 'a', name: 'A', location: null, statusClientId: 'status-a', lastSeenAt: hoursAgo(13), updatedAt: now },
      { id: 'edge', name: 'E', location: null, statusClientId: null, lastSeenAt: hoursAgo(12), updatedAt: now },
      { id: 'old', name: 'O', location: null, statusClientId: 'missing', lastSeenAt: null, updatedAt: hoursAgo(12.01) },
    ] as never);

    const { targets } = (await call()).json() as { targets: Array<{ clientId: string; stale: boolean; lastSeen: string }> };
    expect(targets.map(({ clientId, stale, lastSeen }) => ({ clientId, stale, lastSeen }))).toEqual([
      { clientId: 'a', stale: true, lastSeen: hoursAgo(13).toISOString() },
      { clientId: 'edge', stale: false, lastSeen: hoursAgo(12).toISOString() },
      { clientId: 'old', stale: true, lastSeen: hoursAgo(12.01).toISOString() },
    ]);
  });
});
