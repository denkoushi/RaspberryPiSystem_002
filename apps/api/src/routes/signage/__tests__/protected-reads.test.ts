import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/clients/client-device-auth.service.js', () => ({
  findClientDeviceByApiKey: vi.fn(async (key: string) => key === 'registered-key' ? { id: 'device' } : null),
}));
vi.mock('../../../lib/photo-storage.js', () => ({
  PhotoStorage: { readPhoto: vi.fn(async () => Buffer.from('photo')), readThumbnail: vi.fn(async () => Buffer.from('thumbnail')) },
}));
vi.mock('../../../services/signage/signage.renderer.js', () => ({
  SignageRenderer: class { async renderVisualizationToBuffer() { return Buffer.from('image'); } },
}));

import { signTestAccessToken as signAccessToken } from '../../../test/auth-session-fixture.js';
import { prisma } from '../../../lib/prisma.js';
import { registerPhotoStorageRoutes } from '../../storage/photos.js';
import { registerThumbnailStorageRoutes } from '../../storage/thumbnails.js';
import { registerScheduleRoutes } from '../schedules.js';
import { registerVisualizationImageRoute } from '../visualization-image.js';

const service = { getSchedules: vi.fn(async () => []) };
const viewer = { id: 'viewer', username: 'viewer', role: 'VIEWER', status: 'ACTIVE', mfaEnabled: false };

describe.each([
  ['/api/storage/photos/test.jpg', 'private, max-age=86400'],
  ['/api/storage/thumbnails/test.jpg', 'private, max-age=86400'],
  ['/api/signage/visualization-image/11111111-1111-4111-8111-111111111111', 'private, max-age=30'],
  ['/api/signage/schedules', null],
])('protected read %s', (url, cacheControl) => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    vi.spyOn(prisma.authSession, 'findUnique').mockImplementation(async ({ where }) => ({ id: where.id, userId: where.id, expiresAt: new Date(Date.now() + 86400000), revokedAt: null }) as never);
    vi.spyOn(prisma.visualizationDashboard, 'findUnique').mockResolvedValue({ id: 'dashboard' } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(viewer as never);
    app = Fastify();
    await app.register(async (routes) => {
      registerPhotoStorageRoutes(routes);
      registerThumbnailStorageRoutes(routes);
    }, { prefix: '/api' });
    await app.register(async (routes) => {
      registerScheduleRoutes(routes, service as never);
      registerVisualizationImageRoute(routes, service as never);
    }, { prefix: '/api/signage' });
  });
  afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

  it.each([
    ['no credentials', {}],
    ['unknown terminal', { 'x-client-key': 'unknown' }],
  ])('requires login for %s', async (_, headers) => {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(401);
  });

  it('does not use a query key', async () => {
    expect((await app.inject({ url: `${url}?key=registered-key&clientKey=registered-key` })).statusCode).toBe(401);
  });

  it.each(['device', 'viewer', 'viewer with unknown key'])('allows %s', async (mode) => {
    const headers = mode === 'device'
      ? { 'x-client-key': 'registered-key' }
      : { authorization: `Bearer ${signAccessToken(viewer as never)}`, ...(mode.includes('unknown') ? { 'x-client-key': 'unknown' } : {}) };
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    if (cacheControl) expect(response.headers['cache-control']).toBe(cacheControl);
  });
});
