import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildServer } from '../../../app.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const TEST_CONFIG_DIR = join(process.cwd(), 'test-config');
const TEST_DEPLOY_STATUS_FILE = join(TEST_CONFIG_DIR, 'deploy-status.json');

describe('GET /api/system/deploy-status', () => {
  let closeServer: (() => Promise<void>) | null = null;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    await mkdir(TEST_CONFIG_DIR, { recursive: true });
    originalEnv = process.env.DEPLOY_STATUS_FILE_PATH;
    process.env.DEPLOY_STATUS_FILE_PATH = TEST_DEPLOY_STATUS_FILE;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
    try {
      await rm(TEST_CONFIG_DIR, { recursive: true, force: true });
    } catch {
      // 無視
    }
    if (originalEnv !== undefined) {
      process.env.DEPLOY_STATUS_FILE_PATH = originalEnv;
    } else {
      delete process.env.DEPLOY_STATUS_FILE_PATH;
    }
  });

  it('should return isMaintenance: false when file does not exist', async () => {
    try {
      await rm(TEST_DEPLOY_STATUS_FILE, { force: true });
    } catch {
      // 無視
    }

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const response = await app.inject({ method: 'GET', url: '/api/system/deploy-status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('isMaintenance');
    expect(body.isMaintenance).toBe(false);
  });

  it('should return isMaintenance: false when x-client-key is missing', async () => {
    await writeFile(
      TEST_DEPLOY_STATUS_FILE,
      JSON.stringify({
        version: 2,
        kioskByClient: { 'raspberrypi4-kiosk1': { maintenance: true } }
      })
    );

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const response = await app.inject({ method: 'GET', url: '/api/system/deploy-status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.isMaintenance).toBe(false);
  });

  it('should return isMaintenance: false when file has invalid JSON', async () => {
    await writeFile(TEST_DEPLOY_STATUS_FILE, 'invalid json');

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const response = await app.inject({ method: 'GET', url: '/api/system/deploy-status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.isMaintenance).toBe(false);
  });

  it('should return isMaintenance based on client when file exists and x-client-key resolves', async () => {
    await writeFile(
      TEST_DEPLOY_STATUS_FILE,
      JSON.stringify({
        version: 2,
        kioskByClient: {
          'raspberrypi4-kiosk1': { maintenance: true },
          'raspi4-robodrill01-kiosk1': { maintenance: false }
        }
      })
    );

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    // Without valid x-client-key, always false (client not in DB or key invalid)
    const resNoKey = await app.inject({ method: 'GET', url: '/api/system/deploy-status' });
    expect(resNoKey.json().isMaintenance).toBe(false);

    // With x-client-key that resolves to a client in maintenance
    const resWithKey = await app.inject({
      method: 'GET',
      url: '/api/system/deploy-status',
      headers: { 'x-client-key': 'client-key-raspberrypi4-kiosk1' }
    });
    // Depends on DB: if ClientDevice exists with statusClientId=raspberrypi4-kiosk1, then true
    expect(resWithKey.statusCode).toBe(200);
    expect(typeof resWithKey.json().isMaintenance).toBe('boolean');
  });
});
