import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env.js', () => ({ env: { SIGNAGE_RENDER_INTERVAL_SECONDS: 30 } }));
vi.mock('../../lib/auth.js', () => ({
  authorizeRoles: () => async (request: { headers: Record<string, unknown> }) => {
    if (request.headers.authorization !== 'Bearer viewer') {
      throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    }
  },
}));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  findClientDeviceByApiKey: vi.fn(async (key: string) => key === 'invalid' ? null : { id: 'device' }),
}));
vi.mock('../../lib/photo-storage.js', () => ({
  PhotoStorage: { readPhoto: vi.fn(async () => Buffer.from('jpeg')) },
}));
vi.mock('../../lib/pdf-storage.js', () => ({
  PdfStorage: { readPdf: vi.fn(async () => Buffer.from('pdf')) },
}));
vi.mock('../../lib/measuring-instrument-genre-image-storage.js', () => ({
  MeasuringInstrumentGenreImageStorage: {
    read: vi.fn(async () => ({ buffer: Buffer.from('jpeg'), contentType: 'image/jpeg' })),
  },
}));
vi.mock('../../lib/part-measurement-drawing-storage.js', () => ({
  parseDerivativeWidth: () => undefined,
  PartMeasurementDrawingStorage: {
    statDrawing: vi.fn(async () => ({ size: 4, mtimeMs: 1 })),
    readDrawing: vi.fn(async () => ({ buffer: Buffer.from('jpeg'), contentType: 'image/jpeg' })),
  },
}));
vi.mock('../../lib/signage-render-storage.js', () => ({
  SignageRenderStorage: { readCurrentImage: vi.fn(async () => Buffer.from('jpeg')) },
}));
vi.mock('../../services/signage/signage.renderer.js', () => ({ SignageRenderer: class {} }));

import { registerRateLimit } from '../../plugins/rate-limit.js';
import { registerRenderRoutes } from '../signage/render.js';
import { registerMeasuringInstrumentGenreStorageRoutes } from '../storage/measuring-instrument-genres.js';
import { registerPartMeasurementDrawingStorageRoutes } from '../storage/part-measurement-drawings.js';
import { registerPdfStorageRoutes } from '../storage/pdfs.js';
import { registerPhotoStorageRoutes } from '../storage/photos.js';
import { registerActiveLoansRoute } from '../tools/loans/active.js';

const urls = [
  '/api/signage/render/status',
  '/api/signage/current-image',
  '/api/storage/measuring-instrument-genres/sample.jpg',
  '/api/storage/part-measurement-drawings/sample.jpg',
  '/api/storage/pdfs/sample.pdf',
  '/api/storage/photos/sample.jpg',
  '/api/tools/loans/active',
];
const apps: FastifyInstance[] = [];

async function makeApp(smallLimit = true) {
  const app = Fastify();
  apps.push(app);
  if (smallLimit) {
    // Scale the real route max down without replacing its identity or allowList.
    app.addHook('onRoute', (route) => {
      const options = route.config?.rateLimit;
      if (options && typeof options.max === 'function') {
        const max = options.max;
        options.max = async (request, key) => (await max(request, key)) / 3000;
      }
    });
  }
  await app.register(registerRateLimit);
  app.decorate('signageRenderScheduler', { isRunning: () => false } as never);
  await app.register(async (instance) => {
    registerMeasuringInstrumentGenreStorageRoutes(instance);
    registerPartMeasurementDrawingStorageRoutes(instance);
    registerPdfStorageRoutes(instance);
    registerPhotoStorageRoutes(instance);
  }, { prefix: '/api' });
  await app.register(async (instance) => registerRenderRoutes(instance, {} as never), { prefix: '/api/signage' });
  await app.register(async (instance) => registerActiveLoansRoute(instance, {
    resolveClientId: vi.fn(async () => 'device'),
    findActive: vi.fn(async () => []),
  } as never), { prefix: '/api/tools/loans' });
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('device read rate limits with the global plugin', () => {
  it.each(urls)('allows a generous normal burst with production config: %s', async (url) => {
    const app = await makeApp(false);
    for (let n = 0; n < 1200; n++) {
      const response = await app.inject({ url, headers: { 'x-client-key': 'device-a' } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe('12000');
    }
    const fallback = await app.inject({ url, headers: { authorization: 'Bearer viewer' } });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.headers['x-ratelimit-limit']).toBe('96000');
  });

  it.each(urls)('enforces the boundary and isolates client keys: %s', async (url) => {
    const app = await makeApp();
    const request = { url, headers: { 'x-client-key': 'device-a' } };
    for (let n = 0; n < 4; n++) expect((await app.inject(request)).statusCode).toBe(200);
    const blocked = await app.inject(request);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
    expect(blocked.headers['retry-after']).toBeDefined();
    expect((await app.inject({ url, headers: { 'x-client-key': 'device-b' } })).statusCode).toBe(200);
    expect((await app.inject({ ...request, remoteAddress: '127.0.0.2' })).statusCode).toBe(429);
  });

  it.each(urls.filter((url) => url.includes('/storage/')))('shares wildcard file and query counters: %s', async (url) => {
    const app = await makeApp();
    for (let n = 0; n < 5; n++) {
      const response = await app.inject({
        url: url.replace('sample', `file-${n}`) + `?t=${n}`,
        headers: { 'x-client-key': 'device-a' },
      });
      expect(response.statusCode).toBe(n < 4 ? 200 : 429);
    }
  });

  it('keeps separate routes independent for the same client', async () => {
    const app = await makeApp();
    for (let n = 0; n < 5; n++) {
      await app.inject({ url: urls[5], headers: { 'x-client-key': 'device-a' } });
    }
    for (const url of urls.filter((url) => url !== urls[5])) {
      expect((await app.inject({ url, headers: { 'x-client-key': 'device-a' } })).statusCode).toBe(200);
    }
  });

  it('uses the current-image query key before the header and ignores cache busters', async () => {
    const app = await makeApp();
    for (let n = 0; n < 5; n++) {
      const response = await app.inject({
        url: `/api/signage/current-image?key=device-a&t=${n}`,
        headers: { 'x-client-key': `ignored-${n}` },
      });
      expect(response.statusCode).toBe(n < 4 ? 200 : 429);
    }
    expect((await app.inject('/api/signage/current-image?key=device-b')).statusCode).toBe(200);
    expect((await app.inject({
      url: '/api/signage/current-image?key=', headers: { 'x-client-key': 'device-a' },
    })).statusCode).toBe(429);
  });

  it('normalizes quoted header keys into the same counter', async () => {
    const app = await makeApp();
    for (let n = 0; n < 4; n++) {
      expect((await app.inject({ url: urls[6], headers: { 'x-client-key': 'device-a' } })).statusCode).toBe(200);
    }
    expect((await app.inject({ url: urls[6], headers: { 'x-client-key': '"device-a"' } })).statusCode).toBe(429);
  });

  it('provides the larger fallback bucket per IP and per route', async () => {
    const app = await makeApp();
    const request = { url: urls[6], headers: { authorization: 'Bearer viewer' } };
    for (let n = 0; n < 32; n++) expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(429);
    expect((await app.inject({ ...request, remoteAddress: '127.0.0.2' })).statusCode).toBe(200);
    expect((await app.inject({ ...request, url: urls[5] })).statusCode).toBe(200);
  });

  it('demonstrates inherited allowList and leaves other skipped routes unchanged', async () => {
    const app = await makeApp();
    app.get('/api/storage/inherited/*', { config: { rateLimit: { max: 1 } } }, async () => 'ok');
    app.get('/api/signage/other', async () => 'ok');
    app.get('/api/tools/loans/borrow', { config: { rateLimit: false } }, async () => 'ok');
    for (const url of ['/api/storage/inherited/a', '/api/signage/other', '/api/tools/loans/borrow']) {
      for (let n = 0; n < 125; n++) {
        const response = await app.inject(url);
        expect(response.statusCode).toBe(200);
        expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      }
    }
  });

  it('retains successful response bodies and caching headers', async () => {
    const app = await makeApp();
    const headers = { 'x-client-key': 'device-a' };
    const photo = await app.inject({ url: urls[5], headers });
    expect(photo.body).toBe('jpeg');
    expect(photo.headers['cache-control']).toBe('private, max-age=86400');
    const drawing = await app.inject({ url: urls[3], headers });
    expect(drawing.headers['cache-control']).toBe('private, max-age=86400, immutable');
    expect(drawing.headers.etag).toBe('"4-1"');
    const image = await app.inject({ url: urls[1], headers });
    expect(image.body).toBe('jpeg');
    expect(image.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: urls[0], headers })).json()).toEqual({ isRunning: false, intervalSeconds: 30 });
    expect((await app.inject({ url: urls[6], headers })).json()).toEqual({ loans: [] });
  });

  it.each(urls)('still rejects requests without authentication: %s', async (url) => {
    const app = await makeApp();
    expect((await app.inject(url)).statusCode).toBe(401);
  });

  it.each([urls[0], urls[1], urls[4]])('still rejects an invalid key despite a JWT: %s', async (url) => {
    const app = await makeApp();
    expect((await app.inject({ url, headers: { 'x-client-key': 'invalid', authorization: 'Bearer viewer' } })).statusCode).toBe(401);
  });

  it.each([urls[2], urls[3], urls[5]])('retains JWT fallback for an invalid key: %s', async (url) => {
    const app = await makeApp();
    expect((await app.inject({ url, headers: { 'x-client-key': 'invalid', authorization: 'Bearer viewer' } })).statusCode).toBe(200);
  });
});
