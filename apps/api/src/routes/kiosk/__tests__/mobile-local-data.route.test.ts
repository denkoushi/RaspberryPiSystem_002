import { gzipSync } from 'node:zlib';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import {
  getMobileDataSnapshot,
  getMobileDataVersions,
  MobileDataVersionChangedError,
} from '../../../services/mobile-placement/mobile-local-data.service.js';
import { registerMobileLocalDataRoutes } from '../mobile-local-data.js';

// Keep error logging off the database: the handler otherwise resolves the device via Prisma.
vi.mock('../../../services/clients/error-log-device.service.js', () => ({ resolveErrorLogDevice: async () => undefined }));
vi.mock('../../../services/mobile-placement/mobile-local-data.service.js', () => ({
  getMobileDataVersions: vi.fn(),
  getMobileDataSnapshot: vi.fn(),
  MobileDataVersionChangedError: class MobileDataVersionChangedError extends Error {},
}));

const v = (version: string) => ({ version, dataUpdatedAt: '2026-11-04T00:00:00.000Z' });
const versions = {
  purchase: v('p2'),
  legacyPurchase: v('p1'),
  purchaseEnrichment: v('pe'),
  schedule: v('s1'),
  placements: v('pl'),
};
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const snapshotFor = (version: string, pages: unknown[][] = [[{ id: 1 }], [{ id: 2 }]]) => ({
  version,
  dataUpdatedAt: null,
  rowCount: pages.flat().length,
  buildMs: 1,
  pageSize: 1,
  jsonBytes: json(pages.flat()).length,
  gzip: gzipSync(json(pages.flat())),
  pages: pages.map((rows) => ({ jsonBytes: json(rows).length, gzip: gzipSync(json(rows)) })),
});

describe('kiosk mobile local data routes', () => {
  let app: ReturnType<typeof Fastify>;
  const requireClientDevice = vi.fn();

  beforeEach(async () => {
    vi.resetAllMocks();
    requireClientDevice.mockImplementation(async (key: unknown) => {
      if (key !== 'kiosk-key') throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
      return { clientKey: key, clientDevice: { id: 'd' } };
    });
    vi.mocked(getMobileDataVersions).mockResolvedValue(versions as never);
    vi.mocked(getMobileDataSnapshot).mockImplementation((async (kind: keyof typeof versions) => snapshotFor(versions[kind].version)) as never);
    app = Fastify();
    registerErrorHandler(app);
    await registerMobileLocalDataRoutes(app, { requireClientDevice } as never);
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers: { 'x-client-key': 'kiosk-key', ...headers } });

  it('requires a registered client before exposing versions or data', async () => {
    expect((await get('/kiosk/mobile-local-data/versions', { 'x-client-key': 'bad' })).statusCode).toBe(401);
    expect((await get('/kiosk/mobile-local-data/schedule', { 'x-client-key': 'bad' })).statusCode).toBe(401);
    expect(getMobileDataVersions).not.toHaveBeenCalled();
  });

  it('serves the legacy versions shape by default and the paged shape for format=2', async () => {
    const legacy = await get('/kiosk/mobile-local-data/versions');
    expect(legacy.headers['cache-control']).toBe('private, no-store');
    expect(legacy.json()).toEqual({ purchase: v('p1'), schedule: v('s1'), placements: v('pl') });

    const paged = await get('/kiosk/mobile-local-data/versions?format=2');
    expect(paged.json()).toEqual({ purchase: v('p2'), schedule: v('s1'), placements: v('pl'), purchaseEnrichment: v('pe'), paged: true });
  });

  it('answers 304 when the device already holds the current version', async () => {
    const response = await get('/kiosk/mobile-local-data/schedule?version=s1');
    expect(response.statusCode).toBe(304);
    expect(getMobileDataSnapshot).not.toHaveBeenCalled();
  });

  it('maps legacy purchase downloads to the legacy dataset and compares against its version', async () => {
    expect((await get('/kiosk/mobile-local-data/purchase?version=p1')).statusCode).toBe(304);
    expect((await get('/kiosk/mobile-local-data/purchase?format=2&version=p1')).statusCode).toBe(200);
    expect(getMobileDataSnapshot).toHaveBeenCalledWith('purchase', v('p2'));
  });

  it('sends gzip only when the client accepts it with a non-zero quality', async () => {
    const gz = await get('/kiosk/mobile-local-data/schedule', { 'accept-encoding': 'br, gzip;q=0.5' });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gz.headers.vary).toBe('Accept-Encoding');

    const refused = await get('/kiosk/mobile-local-data/schedule', { 'accept-encoding': 'gzip;q=0' });
    expect(refused.headers['content-encoding']).toBeUndefined();
    expect(refused.json()).toEqual([{ id: 1 }, { id: 2 }]);

    const plain = await get('/kiosk/mobile-local-data/schedule');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers['content-type']).toContain('application/json');
  });

  it('serves a single 1-based page for format=2 and 400 for a page past the end', async () => {
    const page2 = await get('/kiosk/mobile-local-data/schedule?format=2&page=2&pageVersion=s1');
    expect(page2.statusCode).toBe(200);
    expect(page2.json()).toEqual([{ id: 2 }]);
    expect((await get('/kiosk/mobile-local-data/schedule?format=2&page=3')).statusCode).toBe(400);
  });

  it('rejects paging outside format=2 and for purchaseEnrichment', async () => {
    expect((await get('/kiosk/mobile-local-data/schedule?page=1')).statusCode).toBe(400);
    expect((await get('/kiosk/mobile-local-data/purchaseEnrichment?format=2&page=1')).statusCode).toBe(400);
    expect((await get('/kiosk/mobile-local-data/schedule?format=2&page=0')).statusCode).toBe(400);
    expect((await get('/kiosk/mobile-local-data/unknown')).statusCode).toBe(400);
  });

  it('returns 409 with the current version when a paged download straddles a data change', async () => {
    const response = await get('/kiosk/mobile-local-data/schedule?format=2&page=2&pageVersion=old');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(v('s1'));
    expect(getMobileDataSnapshot).not.toHaveBeenCalled();
  });

  it('returns 409 when the snapshot was rebuilt from newer data than the version read for a page', async () => {
    vi.mocked(getMobileDataSnapshot).mockResolvedValue(snapshotFor('s2') as never);
    expect((await get('/kiosk/mobile-local-data/schedule?format=2&page=1')).statusCode).toBe(409);
  });

  it('returns 409 for a paged request when the data changed during the build', async () => {
    vi.mocked(getMobileDataSnapshot).mockRejectedValue(new MobileDataVersionChangedError());
    expect((await get('/kiosk/mobile-local-data/schedule?format=2&page=1')).statusCode).toBe(409);
  });

  it('does not swallow a build version change for a full download', async () => {
    vi.mocked(getMobileDataSnapshot).mockRejectedValue(new MobileDataVersionChangedError());
    expect((await get('/kiosk/mobile-local-data/schedule')).statusCode).toBe(500);
  });

  it('serves a full download even when the snapshot version differs from the version read', async () => {
    // Only paged downloads enforce version consistency; a full snapshot carries its own version.
    vi.mocked(getMobileDataSnapshot).mockResolvedValue(snapshotFor('s2') as never);
    const response = await get('/kiosk/mobile-local-data/schedule');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
