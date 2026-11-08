import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { requireKioskClientDevice } from '../../services/clients/client-device-auth.service.js';
import { registerKioskSignagePreviewRoutes } from './signage-preview.js';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), readImage: vi.fn(), renderMessage: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { clientDevice: { findUnique: mocks.findUnique, findFirst: mocks.findFirst, findMany: mocks.findMany, update: mocks.update } },
}));
vi.mock('../../lib/signage-render-storage.js', () => ({ SignageRenderStorage: { readCurrentImage: mocks.readImage } }));
vi.mock('../../services/signage/index.js', () => ({ SignageService: class {} }));
vi.mock('../../services/signage/signage.renderer.js', () => ({
  SignageRenderer: class { renderMessage = mocks.renderMessage; },
}));

const kiosk = { id: '11111111-1111-4111-8111-111111111111', name: 'Fixture kiosk', apiKey: 'client-key-fixture-only-kiosk' };
const signage = { id: '22222222-2222-4222-8222-222222222222', name: 'Fixture signage', isSignage: true, location: 'Test room', apiKey: 'client-key-fixture-only-signage' };
const otherId = '33333333-3333-4333-8333-333333333333';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]);
let storedTarget: string | null;
let legacyTarget: string | null | undefined;

describe('kiosk signage preview credential boundary', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    storedTarget = null;
    legacyTarget = undefined;
    mocks.findUnique.mockImplementation(async (query) => {
      if (query.where.apiKey === kiosk.apiKey) return kiosk;
      if (query.where.id === kiosk.id) return { signagePreviewTargetDeviceId: storedTarget, signagePreviewTargetApiKey: legacyTarget === undefined ? storedTarget : legacyTarget };
      if (query.where.id === signage.id || query.where.apiKey === signage.apiKey) return signage;
      return null;
    });
    mocks.findFirst.mockImplementation(async (query) => {
      const values = query.where.OR.flatMap((cond: Record<string, string>) => Object.values(cond));
      return values.includes(signage.id) || values.includes(signage.apiKey) ? signage : null;
    });
    mocks.findMany.mockResolvedValue([{ ...signage, clientSecret: 'fixture-only-future-secret' }]);
    mocks.update.mockImplementation(async (query) => {
      storedTarget = query.data.signagePreviewTargetDeviceId;
      return {};
    });
    mocks.readImage.mockResolvedValue(jpeg);
    mocks.renderMessage.mockResolvedValue(jpeg);
  });

  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  async function buildApp() {
    const app = Fastify();
    registerErrorHandler(app);
    await registerKioskSignagePreviewRoutes(app, { requireClientDevice: requireKioskClientDevice });
    apps.push(app);
    return app;
  }

  it.each(['/options', '/image'])('requires a valid own device credential for %s', async (suffix) => {
    const app = await buildApp();
    for (const headers of [{}, { 'x-client-key': 'fixture-only-invalid' }]) {
      const response = await app.inject({ method: 'GET', url: '/kiosk/signage-preview' + suffix, headers });
      expect(response.statusCode).toBe(401);
    }
    expect(mocks.readImage).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('returns IDs and display fields only, with the own-device default', async () => {
    const response = await (await buildApp()).inject({ method: 'GET', url: '/kiosk/signage-preview/options', headers: { 'x-client-key': kiosk.apiKey } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      candidates: [{ id: signage.id, name: signage.name, location: signage.location }],
      selectedClientDeviceId: null, effectivePreviewClientDeviceId: kiosk.id,
    });
    for (const secret of [kiosk.apiKey, signage.apiKey, 'fixture-only-future-secret']) expect(response.body).not.toContain(secret);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isSignage: true } }));
  });

  it('preserves a saved ID selection without rewriting it on GET', async () => {
    storedTarget = signage.id;
    const response = await (await buildApp()).inject({ method: 'GET', url: '/kiosk/signage-preview/options', headers: { 'x-client-key': kiosk.apiKey } });
    expect(response.json().selectedClientDeviceId).toBe(signage.id);
    expect(response.json().effectivePreviewClientDeviceId).toBe(signage.id);
    expect(response.body).not.toContain(signage.apiKey);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'different columns', id: otherId, legacy: signage.id, expected: signage.id },
    { name: 'legacy cleared', id: signage.id, legacy: null, expected: null },
    { name: 'equal columns', id: signage.id, legacy: signage.id, expected: signage.id },
    { name: 'legacy only', id: null, legacy: signage.id, expected: signage.id },
  ])('uses the saved target for $name in options and images', async ({ id, legacy, expected }) => {
    storedTarget = id;
    legacyTarget = legacy;
    const app = await buildApp();
    const headers = { 'x-client-key': kiosk.apiKey };
    const options = await app.inject({ method: 'GET', url: '/kiosk/signage-preview/options', headers });
    expect(options.statusCode).toBe(200);
    expect(options.json().selectedClientDeviceId).toBe(expected);
    const image = await app.inject({ method: 'GET', url: '/kiosk/signage-preview/image', headers });
    expect(image.statusCode).toBe(200);
    expect(mocks.readImage).toHaveBeenCalledWith(expected ?? kiosk.id);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: kiosk.id },
      select: { signagePreviewTargetDeviceId: true, signagePreviewTargetApiKey: true },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('falls back to own device when a saved target is no longer a candidate', async () => {
    storedTarget = otherId;
    const response = await (await buildApp()).inject({ method: 'GET', url: '/kiosk/signage-preview/options', headers: { 'x-client-key': kiosk.apiKey } });
    expect(response.json().selectedClientDeviceId).toBeNull();
    expect(response.json().effectivePreviewClientDeviceId).toBe(kiosk.id);
  });

  it('keeps an ID-valued selection valid when its server-side credential changes', async () => {
    storedTarget = signage.id;
    const rotated = { ...signage, apiKey: 'client-key-fixture-only-signage-rotated' };
    mocks.findMany.mockResolvedValue([rotated]);
    const response = await (await buildApp()).inject({ method: 'GET', url: '/kiosk/signage-preview/image', headers: { 'x-client-key': kiosk.apiKey } });
    expect(response.statusCode).toBe(200);
    expect(mocks.readImage).toHaveBeenCalledWith(rotated.id);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(['id', 'legacy', 'legacy-id', 'cached-id'] as const)('accepts %s selection input and stores the ID in both fields', async (format) => {
    const payload = format === 'id' ? { signagePreviewTargetDeviceId: signage.id }
      : format === 'cached-id' ? { signagePreviewTargetClientDeviceId: signage.id }
      : { signagePreviewTargetApiKey: format === 'legacy-id' ? signage.id : signage.apiKey };
    const response = await (await buildApp()).inject({ method: 'PUT', url: '/kiosk/signage-preview/selection', headers: { 'x-client-key': kiosk.apiKey }, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, signagePreviewTargetDeviceId: signage.id, signagePreviewTargetClientDeviceId: signage.id });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: kiosk.id }, data: { signagePreviewTargetDeviceId: signage.id, signagePreviewTargetApiKey: signage.id } });
    expect(storedTarget).toBe(signage.id);
    expect(response.body).not.toContain(signage.apiKey);
  });

  it('rejects a device without isSignage even when its key contains signage', async () => {
    mocks.findUnique.mockImplementation(async (query) => {
      if (query.where.apiKey === kiosk.apiKey) return kiosk;
      if (query.where.id === signage.id) return { ...signage, isSignage: false };
      return null;
    });
    const response = await (await buildApp()).inject({ method: 'PUT', url: '/kiosk/signage-preview/selection',
      headers: { 'x-client-key': kiosk.apiKey }, payload: { signagePreviewTargetDeviceId: signage.id } });
    expect(response.statusCode).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('clears a selection and rejects unknown IDs without saving them', async () => {
    const app = await buildApp();
    const headers = { 'x-client-key': kiosk.apiKey };
    storedTarget = signage.id;
    expect((await app.inject({ method: 'PUT', url: '/kiosk/signage-preview/selection', headers, payload: { signagePreviewTargetClientDeviceId: null } })).statusCode).toBe(200);
    expect(storedTarget).toBeNull();
    mocks.update.mockClear();
    for (const id of [otherId, 'not-a-uuid']) {
      expect((await app.inject({ method: 'PUT', url: '/kiosk/signage-preview/selection', headers, payload: { signagePreviewTargetClientDeviceId: id } })).statusCode).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('serves an allowed candidate JPEG using the device ID', async () => {
    const response = await (await buildApp()).inject({ method: 'GET', url: '/kiosk/signage-preview/image?clientDeviceId=' + signage.id, headers: { 'x-client-key': kiosk.apiKey } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.rawPayload).toEqual(jpeg);
    expect(mocks.readImage).toHaveBeenCalledWith(signage.id);
  });

  it('reads a migrated saved image target without credential lookup', async () => {
    storedTarget = signage.id;
    const response = await (await buildApp()).inject({ method: 'GET', url: '/kiosk/signage-preview/image', headers: { 'x-client-key': kiosk.apiKey } });
    expect(response.statusCode).toBe(200);
    expect(mocks.readImage).toHaveBeenCalledWith(signage.id);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects an arbitrary other-device ID before reading image storage', async () => {
    const response = await (await buildApp()).inject({ method: 'GET', url: '/kiosk/signage-preview/image?clientDeviceId=' + otherId, headers: { 'x-client-key': kiosk.apiKey } });
    expect(response.statusCode).toBe(404);
    expect(mocks.readImage).not.toHaveBeenCalled();
  });

  it('keeps own-device and missing-image fallback delivery', async () => {
    mocks.readImage.mockResolvedValue(null);
    const response = await (await buildApp()).inject({ method: 'GET', url: '/kiosk/signage-preview/image?clientDeviceId=' + kiosk.id, headers: { 'x-client-key': kiosk.apiKey } });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(jpeg);
    expect(mocks.readImage).toHaveBeenCalledWith(kiosk.id);
    expect(mocks.renderMessage).toHaveBeenCalledWith('表示するコンテンツがありません');
  });
});
