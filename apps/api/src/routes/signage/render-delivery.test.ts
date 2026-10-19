import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/auth.js', () => ({
  authorizeRoles: () => async () => undefined,
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
import { registerRenderRoutes } from './render.js';

describe('current-image delivery tracking', () => {
  beforeEach(() => {
    resetSignageDeliveryTrackerForTests();
  });

  it('records a fetch by the device itself', async () => {
    const app = Fastify();
    registerRenderRoutes(app, {} as never);
    const response = await app.inject({ method: 'GET', url: '/current-image', headers: { 'x-client-key': 'key-a' } });
    expect(response.statusCode).toBe(200);
    expect(getSignageImageLastFetchedAt('key-a')).toBeInstanceOf(Date);
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
    expect(getSignageImageLastFetchedAt('key-a')).toBeNull();
    await app.close();
  });
});
