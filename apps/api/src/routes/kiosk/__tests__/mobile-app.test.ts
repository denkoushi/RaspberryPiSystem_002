import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerMobileAppRoutes } from '../mobile-app.js';

import type { FastifyInstance } from 'fastify';

describe('mobile app routes', () => {
  let directory: string;
  let app: FastifyInstance;
  const bytes = Buffer.from([0x50, 0x4b, 0, 255, 42]);
  const version = { versionCode: 3, versionName: '0.3', fileName: 'haizen-3.apk', sha256: 'a'.repeat(64), size: bytes.length };
  const headers = { 'x-client-key': 'test-key' };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'haizen-app-'));
    app = Fastify();
    await registerMobileAppRoutes(app, {
      requireClientDevice: async (key) => {
        if (key !== headers['x-client-key']) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
        return {} as never;
      }
    }, { directory });
  });
  afterEach(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const url = (route: string) => `/kiosk/mobile-app/${route}`;
  const publish = () => writeFile(join(directory, 'version.json'), JSON.stringify(version));

  it('rejects unauthenticated requests to both routes', async () => {
    for (const route of ['version', 'apk']) {
      expect((await app.inject({ url: url(route) })).statusCode).toBe(401);
      expect((await app.inject({ url: url(route), headers: { 'x-client-key': 'wrong' } })).statusCode).toBe(401);
    }
  });
  it('returns an empty 404 when the directory is absent', async () => {
    await rm(directory, { recursive: true });
    for (const route of ['version', 'apk']) {
      const response = await app.inject({ url: url(route), headers });
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe('');
    }
  });
  it('returns only public version fields without caching', async () => {
    await publish();
    const response = await app.inject({ url: url('version'), headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ versionCode: 3, versionName: '0.3', sha256: version.sha256, size: bytes.length });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it.each(['../evil.apk', '/evil.apk', 'evil.apk\n'])('rejects unsafe fileName %j on both routes', async (fileName) => {
    await writeFile(join(directory, 'version.json'), JSON.stringify({ ...version, fileName }));
    for (const route of ['version', 'apk']) expect((await app.inject({ url: url(route), headers })).statusCode).toBe(404);
  });
  it.each(['{', JSON.stringify({ ...version, versionCode: 0 }), JSON.stringify({ ...version, sha256: 'bad' }),
    JSON.stringify({ ...version, size: -1 })])('rejects invalid metadata %j', async (json) => {
    await writeFile(join(directory, 'version.json'), json);
    for (const route of ['version', 'apk']) {
      const response = await app.inject({ url: url(route), headers });
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe('');
    }
  });
  it('streams APK bytes with download headers, ignoring client supplied names', async () => {
    await publish();
    await writeFile(join(directory, version.fileName), bytes);
    const response = await app.inject({ url: `${url('apk')}?fileName=other.apk`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(response.headers['content-length']).toBe(String(bytes.length));
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-encoding']).toBeUndefined();
  });
  it('returns 404 when metadata exists but APK is missing', async () => {
    await publish();
    expect((await app.inject({ url: url('apk'), headers })).statusCode).toBe(404);
  });
});
