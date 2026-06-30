import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildServer } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const TEST_CONFIG_DIR = join(process.cwd(), 'test-config');
const TEST_DEPLOY_STATUS_FILE = join(TEST_CONFIG_DIR, 'deploy-status.json');

async function createClientDevice(params: { apiKey: string; statusClientId?: string | null }) {
  return prisma.clientDevice.create({
    data: {
      name: `Deploy Status Test ${params.apiKey}`,
      apiKey: params.apiKey,
      statusClientId: params.statusClientId,
    },
  });
}

describe('GET /api/system/deploy-status', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    await mkdir(TEST_CONFIG_DIR, { recursive: true });
    originalEnv = process.env.DEPLOY_STATUS_FILE_PATH;
    process.env.DEPLOY_STATUS_FILE_PATH = TEST_DEPLOY_STATUS_FILE;
    app = await buildServer();
  });

  beforeEach(async () => {
    await rm(TEST_DEPLOY_STATUS_FILE, { force: true });
  });

  afterAll(async () => {
    await app.close();
    await rm(TEST_CONFIG_DIR, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env.DEPLOY_STATUS_FILE_PATH = originalEnv;
    } else {
      delete process.env.DEPLOY_STATUS_FILE_PATH;
    }
  });

  it('returns 401 when x-client-key is missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/system/deploy-status' });
    expect(response.statusCode).toBe(401);
    expect(response.json().errorCode).toBe('CLIENT_KEY_REQUIRED');
  });

  it('returns 401 when x-client-key is invalid', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/system/deploy-status',
      headers: { 'x-client-key': 'invalid-key' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().errorCode).toBe('INVALID_CLIENT_KEY');
  });

  it('returns isMaintenance: false for a valid client when file does not exist', async () => {
    const client = await createClientDevice({
      apiKey: `deploy-status-key-missing-file-${Date.now()}`,
      statusClientId: 'raspberrypi4-kiosk1',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/system/deploy-status',
      headers: { 'x-client-key': client.apiKey },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().isMaintenance).toBe(false);
  });

  it('returns isMaintenance: false for a valid client when file has invalid JSON', async () => {
    await writeFile(TEST_DEPLOY_STATUS_FILE, 'invalid json');
    const client = await createClientDevice({
      apiKey: `deploy-status-key-invalid-json-${Date.now()}`,
      statusClientId: 'raspberrypi4-kiosk1',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/system/deploy-status',
      headers: { 'x-client-key': client.apiKey },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().isMaintenance).toBe(false);
  });

  it('returns maintenance state for a valid client statusClientId', async () => {
    await writeFile(
      TEST_DEPLOY_STATUS_FILE,
      JSON.stringify({
        version: 2,
        kioskByClient: {
          'raspberrypi4-kiosk1': { maintenance: true },
          'raspi4-robodrill01-kiosk1': { maintenance: false },
        },
      }),
    );

    const maintenanceClient = await createClientDevice({
      apiKey: `deploy-status-key-maintenance-${Date.now()}`,
      statusClientId: 'raspberrypi4-kiosk1',
    });
    const normalClient = await createClientDevice({
      apiKey: `deploy-status-key-normal-${Date.now()}`,
      statusClientId: 'raspi4-robodrill01-kiosk1',
    });

    const maintenance = await app.inject({
      method: 'GET',
      url: '/api/system/deploy-status',
      headers: { 'x-client-key': maintenanceClient.apiKey },
    });
    expect(maintenance.statusCode).toBe(200);
    expect(maintenance.json().isMaintenance).toBe(true);

    const normal = await app.inject({
      method: 'GET',
      url: '/api/system/deploy-status',
      headers: { 'x-client-key': normalClient.apiKey },
    });
    expect(normal.statusCode).toBe(200);
    expect(normal.json().isMaintenance).toBe(false);
  });

  it('returns isMaintenance: false for a valid client without statusClientId', async () => {
    await writeFile(
      TEST_DEPLOY_STATUS_FILE,
      JSON.stringify({
        version: 2,
        kioskByClient: {
          'raspberrypi4-kiosk1': { maintenance: true },
        },
      }),
    );
    const client = await createClientDevice({
      apiKey: `deploy-status-key-no-status-id-${Date.now()}`,
      statusClientId: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/system/deploy-status',
      headers: { 'x-client-key': client.apiKey },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().isMaintenance).toBe(false);
  });
});
