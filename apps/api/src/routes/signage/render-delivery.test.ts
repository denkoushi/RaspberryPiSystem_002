import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ manage: vi.fn(async () => undefined), view: vi.fn(async () => undefined) }));
vi.mock('../../lib/auth.js', () => ({
  authorizeRoles: (...roles: string[]) => roles.includes('VIEWER') ? auth.view : auth.manage,
}));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  findClientDeviceByApiKey: vi.fn().mockResolvedValue({ id: 'device' }),
}));
vi.mock('../../lib/signage-render-storage.js', () => ({
  SignageRenderStorage: { readCurrentImage: vi.fn().mockResolvedValue(Buffer.from('jpeg')) },
}));
vi.mock('../../services/signage/signage.renderer.js', () => ({
  SignageRenderer: class {},
}));

import {
  getSignageImageLastFetchedAt,
  resetSignageDeliveryTrackerForTests,
} from '../../services/signage/signage-delivery-tracker.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { findClientDeviceByApiKey } from '../../services/clients/client-device-auth.service.js';
import { registerRenderRoutes } from './render.js';

describe('current-image delivery tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSignageDeliveryTrackerForTests();
  });

  it('records a fetch by the device itself', async () => {
    const app = Fastify();
    registerRenderRoutes(app, {} as never);
    const response = await app.inject({ method: 'GET', url: '/current-image', headers: { 'x-client-key': 'key-a' } });
    expect(response.statusCode).toBe(200);
    expect(getSignageImageLastFetchedAt('device')).toBeInstanceOf(Date);
    expect(SignageRenderStorage.readCurrentImage).toHaveBeenCalledWith('device');
    expect(getSignageImageLastFetchedAt('key-a')).toBeNull();
    await app.close();
  });

  it('does not count an admin preview (JWT) as the device receiving the image', async () => {
    const app = Fastify();
    registerRenderRoutes(app, {} as never);
    const response = await app.inject({
      method: 'GET',
      url: '/current-image?key=key-a',
      headers: { authorization: 'Bearer admin-jwt' },
    });
    expect(response.statusCode).toBe(200);
    expect(getSignageImageLastFetchedAt('device')).toBeNull();
    expect(getSignageImageLastFetchedAt('key-a')).toBeNull();
    await app.close();
  });
  it('requires management authorization for ID previews and skips delivery tracking', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const app = Fastify();
    registerRenderRoutes(app, {} as never);
    const response = await app.inject({ method: 'GET', url: '/current-image?clientDeviceId=' + id, headers: { authorization: 'Bearer admin-jwt' } });
    expect(response.statusCode).toBe(200);
    expect(auth.manage).toHaveBeenCalledOnce();
    expect(findClientDeviceByApiKey).not.toHaveBeenCalled();
    expect(SignageRenderStorage.readCurrentImage).toHaveBeenCalledWith(id);
    expect(getSignageImageLastFetchedAt(id)).toBeNull();
    await app.close();
  });

});
