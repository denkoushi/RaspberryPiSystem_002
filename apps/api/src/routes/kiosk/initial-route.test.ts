import { KIOSK_INITIAL_ROUTE_IDS, KIOSK_INITIAL_ROUTE_PATHS } from '@raspi-system/shared-types';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { requireKioskClientDevice } from '../../services/clients/client-device-auth.service.js';

import { registerKioskInitialRoute } from './initial-route.js';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { clientDevice: mocks } }));

const device = { id: 'self-device-id', apiKey: 'fixture-self-key', defaultMode: 'TAG', kioskInitialRoute: null as string | null };
let stored: typeof device;
const apps: ReturnType<typeof Fastify>[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  stored = { ...device };
  mocks.findUnique.mockImplementation(async ({ where }: { where: { apiKey: string } }) => where.apiKey === device.apiKey ? stored : null);
  mocks.update.mockImplementation(async ({ data }: { data: { kioskInitialRoute: string | null } }) => {
    stored.kioskInitialRoute = data.kioskInitialRoute;
    return { defaultMode: stored.defaultMode };
  });
});
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function put(payload: object, headers: Record<string, string> = { 'x-client-key': device.apiKey }) {
  const app = Fastify();
  apps.push(app);
  registerErrorHandler(app);
  await registerKioskInitialRoute(app, { requireClientDevice: requireKioskClientDevice });
  return app.inject({ method: 'PUT', url: '/kiosk/initial-route', payload, headers });
}

describe('initial-route request boundary without a database', () => {
  it.each(KIOSK_INITIAL_ROUTE_IDS)('saves %s only to the authenticated device', async (initialRoute) => {
    const response = await put({ initialRoute });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, initialKioskRoute: initialRoute, initialKioskPath: KIOSK_INITIAL_ROUTE_PATHS[initialRoute] });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ where: { id: device.id }, data: { kioskInitialRoute: initialRoute }, select: { defaultMode: true } });
    expect(stored.kioskInitialRoute).toBe(initialRoute);
  });

  it.each(['TAG', 'PHOTO'])('clears to null with the %s fallback', async (mode) => {
    stored.defaultMode = mode;
    stored.kioskInitialRoute = 'assembly';
    const response = await put({ initialRoute: null });
    expect(response.json()).toEqual({ ok: true, initialKioskRoute: null, initialKioskPath: mode === 'PHOTO' ? '/kiosk/photo' : '/kiosk/tag' });
    expect(stored.kioskInitialRoute).toBeNull();
  });

  it.each([
    { initialRoute: 'unknown' }, { initialRoute: 'tag_desk' }, { initialRoute: 'due_management' },
    {}, { initialRoute: 123 }, { initialRoute: 'assembly', clientId: 'other-device' },
    { initialRoute: 'assembly', defaultMode: 'PHOTO' }
  ])('rejects invalid or extra body fields: %j', async (payload) => {
    expect((await put(payload)).statusCode).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'CLIENT_KEY_REQUIRED'],
    [{ 'x-client-key': 'unregistered-fixture-key' }, 'INVALID_CLIENT_KEY']
  ] as const)('requires a registered own-device key: %j', async (headers, errorCode) => {
    const response = await put({ initialRoute: 'assembly' }, headers);
    expect(response.statusCode).toBe(401);
    expect(response.json().errorCode).toBe(errorCode);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
