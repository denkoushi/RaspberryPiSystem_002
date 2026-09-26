import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { resetSiteDirectoryForTest, resolveSiteKeyForScopeKey } from '../../lib/site-directory.js';
import { createAuthHeader, createTestClientDevice, createTestUser } from './helpers.js';

/** docs/plans/explicit-site-scope-execplan.md Milestone 3: 管理者による拠点・代理操作の設定 */
describe('site assignment administration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let adminToken: string;
  const siteKey = `テスト拠点-${Date.now()}`;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    adminToken = (await createTestUser('ADMIN')).token;
  });

  afterAll(async () => {
    resetSiteDirectoryForTest();
    await prisma.clientDevice.updateMany({ where: { siteKey }, data: { siteKey: null } });
    await prisma.site.deleteMany({ where: { key: siteKey } });
    await app.close();
  });

  it('creates and lists sites, rejecting duplicates and the location delimiter', async () => {
    const headers = { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' };
    // 表示名は常に拠点名と同じ（別名は受け付けない）。
    const created = await app.inject({
      method: 'POST',
      url: '/api/sites',
      headers,
      payload: { key: ` ${siteKey} `, displayName: '別名' }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().site).toMatchObject({ key: siteKey, displayName: siteKey });

    const duplicate = await app.inject({ method: 'POST', url: '/api/sites', headers, payload: { key: siteKey } });
    expect(duplicate.statusCode).toBe(409);
    const delimiter = await app.inject({ method: 'POST', url: '/api/sites', headers, payload: { key: 'A - B' } });
    expect(delimiter.statusCode).toBe(400);

    const listed = await app.inject({ method: 'GET', url: '/api/sites', headers: createAuthHeader(adminToken) });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().sites.map((site: { key: string }) => site.key)).toEqual(
      expect.arrayContaining(['第2工場', siteKey])
    );
  });

  it('refuses a site key that equals an existing device scope key', async () => {
    const device = await createTestClientDevice();
    const response = await app.inject({
      method: 'POST',
      url: '/api/sites',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: { key: device.name }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode ?? response.json().code).toBe('SITE_KEY_CONFLICTS_WITH_DEVICE');
  });

  it('follows a renamed or relocated device immediately', async () => {
    await prisma.site.upsert({ where: { key: siteKey }, update: {}, create: { key: siteKey, displayName: siteKey } });
    const device = await createTestClientDevice();
    const headers = { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' };
    await app.inject({ method: 'PUT', url: `/api/clients/${device.id}`, headers, payload: { siteKey } });

    const renamed = `renamed-${Date.now()}`;
    await app.inject({ method: 'PUT', url: `/api/clients/${device.id}`, headers, payload: { name: renamed } });
    await app.inject({ method: 'GET', url: '/api/sites', headers: createAuthHeader(adminToken) });
    expect(resolveSiteKeyForScopeKey(renamed)).toBe(siteKey);

    const relocated = `relocated-${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/api/clients/heartbeat',
      headers: { 'Content-Type': 'application/json', 'x-client-key': device.apiKey },
      payload: { location: relocated }
    });
    await app.inject({ method: 'GET', url: '/api/sites', headers: createAuthHeader(adminToken) });
    expect(resolveSiteKeyForScopeKey(relocated)).toBe(siteKey);
  });

  it('lists sites for kiosks with a client key, keeping the previous picker order', async () => {
    const device = await createTestClientDevice();
    const response = await app.inject({
      method: 'GET',
      url: '/api/kiosk/sites',
      headers: { 'x-client-key': device.apiKey }
    });
    expect(response.statusCode).toBe(200);
    const keys = response.json().sites.map((site: { key: string }) => site.key);
    // 他のテストで作った拠点（sortOrder 0）が混ざるため、既定 3 拠点の相対順だけを確認する。
    const planned = ['第2工場', 'トークプラザ', '第1工場'];
    expect(keys.filter((key: string) => planned.includes(key))).toEqual(planned);

    const anonymous = await app.inject({ method: 'GET', url: '/api/kiosk/sites' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('requires a manager or admin for site administration', async () => {
    const viewer = await createTestUser('VIEWER');
    const response = await app.inject({ method: 'GET', url: '/api/sites', headers: createAuthHeader(viewer.token) });
    expect(response.statusCode).toBe(403);
  });

  it('assigns a site and the proxy capability, and the site directory follows immediately', async () => {
    await prisma.site.upsert({ where: { key: siteKey }, update: {}, create: { key: siteKey, displayName: siteKey } });
    const device = await createTestClientDevice();
    const headers = { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' };

    const assigned = await app.inject({
      method: 'PUT',
      url: `/api/clients/${device.id}`,
      headers,
      payload: { siteKey, canProxyOtherDevices: true }
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().client).toMatchObject({ siteKey, canProxyOtherDevices: true });

    // 次のリクエストで対応表が読み直され、端末名（location 未設定時の scope key）が新しい拠点を指す。
    await app.inject({ method: 'GET', url: '/api/sites', headers: createAuthHeader(adminToken) });
    expect(resolveSiteKeyForScopeKey(device.name)).toBe(siteKey);

    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/clients/${device.id}`,
      headers,
      payload: { siteKey: null, canProxyOtherDevices: false }
    });
    expect(cleared.json().client).toMatchObject({ siteKey: null, canProxyOtherDevices: false });
  });

  it('rejects an unregistered site', async () => {
    const device = await createTestClientDevice();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${device.id}`,
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: { siteKey: `未登録-${Date.now()}` }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode ?? response.json().code).toBe('UNKNOWN_SITE');
  });

  it('keeps an existing location when registration or heartbeat sends an empty location', async () => {
    const apiKey = `site-scope-register-${Date.now()}`;
    const headers = { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' };
    await app.inject({ method: 'POST', url: '/api/clients', headers, payload: { apiKey, name: 'reg', location: '第2工場 - Reg' } });

    const blankRegister = await app.inject({ method: 'POST', url: '/api/clients', headers, payload: { apiKey, name: 'reg', location: '' } });
    expect(blankRegister.statusCode).toBe(200);
    const blankHeartbeat = await app.inject({
      method: 'POST',
      url: '/api/clients/heartbeat',
      headers: { 'Content-Type': 'application/json', 'x-client-key': apiKey },
      payload: { location: '   ' }
    });
    expect(blankHeartbeat.statusCode).toBe(200);

    const row = await prisma.clientDevice.findUnique({ where: { apiKey } });
    expect(row?.location).toBe('第2工場 - Reg');
    await prisma.clientDevice.delete({ where: { apiKey } });
  });
});
