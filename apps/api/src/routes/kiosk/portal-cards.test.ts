import { KIOSK_REORDERABLE_HEADER_TAB_IDS } from '@raspi-system/shared-types';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { requireKioskClientDevice } from '../../services/clients/client-device-auth.service.js';
import { registerKioskConfigRoute } from './config.js';
import { registerKioskPortalCardsRoute } from './portal-cards.js';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { clientDevice: mocks } }));
vi.mock('../../services/kiosk/kiosk-header-tab-order.service.js', () => ({
  getKioskHeaderTabOrderSettings: async () => ({ tabOrder: [...KIOSK_REORDERABLE_HEADER_TAB_IDS] })
}));
const device = { id: 'portal-device', apiKey: 'fixture-portal-key', defaultMode: 'TAG', kioskPortalHiddenTabIds: [] as string[] };
let stored: typeof device;
const apps: ReturnType<typeof Fastify>[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  stored = { ...device, kioskPortalHiddenTabIds: [] };
  mocks.findUnique.mockImplementation(async ({ where }: { where: { apiKey: string } }) => where.apiKey === device.apiKey ? stored : null);
  mocks.update.mockImplementation(async ({ data }: { data: Partial<typeof device> }) => {
    Object.assign(stored, data);
    return stored;
  });
});
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function createApp() {
  const app = Fastify();
  apps.push(app);
  registerErrorHandler(app);
  await registerKioskPortalCardsRoute(app, { requireClientDevice: requireKioskClientDevice });
  await registerKioskConfigRoute(app, { normalizeClientKey: (key) => typeof key === 'string' ? key : undefined });
  return app;
}
async function put(payload: object, headers: Record<string, string> = { 'x-client-key': device.apiKey }) {
  return (await createApp()).inject({ method: 'PUT', url: '/kiosk/portal-cards', payload, headers });
}

describe('portal cards own-device settings', () => {
  it('deduplicates and updates only the authenticated device, then returns hidden ids in config', async () => {
    const response = await put({ hiddenTabIds: ['borrow', 'call', 'borrow'] });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, portalHiddenTabIds: ['borrow', 'call'] });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: device.id }, data: { kioskPortalHiddenTabIds: ['borrow', 'call'] }, select: { id: true }
    });
    const config = await apps[0].inject({ method: 'GET', url: '/kiosk/config', headers: { 'x-client-key': device.apiKey } });
    expect(config.statusCode).toBe(200);
    expect(config.json().portalHiddenTabIds).toEqual(['borrow', 'call']);
  });
  it.each([{ hiddenTabIds: [] }, { hiddenTabIds: [...KIOSK_REORDERABLE_HEADER_TAB_IDS] }])('accepts showing all or hiding all cards: %j', async ({ hiddenTabIds }) => {
    expect((await put({ hiddenTabIds })).statusCode).toBe(200);
    expect(stored.kioskPortalHiddenTabIds).toEqual(hiddenTabIds);
  });
  it.each([{}, { hiddenTabIds: null }, { hiddenTabIds: 'call' }, { hiddenTabIds: [123] },
    { hiddenTabIds: ['unknown'] }, { hiddenTabIds: ['portal'] }, { hiddenTabIds: ['call'], clientId: 'other' }
  ])('rejects invalid and extra fields: %j', async (payload) => {
    expect((await put(payload)).statusCode).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([{}, { 'x-client-key': 'unregistered-fixture' }])('requires a registered device: %j', async (headers) => {
    expect((await put({ hiddenTabIds: [] }, headers)).statusCode).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('defaults missing device config to no hidden cards', async () => {
    const app = await createApp();
    const config = await app.inject({ method: 'GET', url: '/kiosk/config' });
    expect(config.statusCode).toBe(200);
    expect(config.json().portalHiddenTabIds).toEqual([]);
  });
});
