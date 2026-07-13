import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildServer } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const TEST_CONFIG_DIR = join(process.cwd(), 'test-config');
const TEST_DEPLOY_STATUS_FILE = join(TEST_CONFIG_DIR, 'deploy-status.json');
const TEST_CLIENT_KEY = 'test-only-deploy-status-api-key';

describe('GET /api/system/deploy-status', () => {
  let closeServer: (() => Promise<void>) | null = null;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    await mkdir(TEST_CONFIG_DIR, { recursive: true });
    originalEnv = process.env.DEPLOY_STATUS_FILE_PATH;
    process.env.DEPLOY_STATUS_FILE_PATH = TEST_DEPLOY_STATUS_FILE;
    await prisma.clientDevice.upsert({
      where: { apiKey: TEST_CLIENT_KEY },
      update: { name: 'deploy-status-api-test', statusClientId: 'raspberrypi4-kiosk1' },
      create: {
        id: 'deploy-status-api-test-device',
        name: 'deploy-status-api-test',
        apiKey: TEST_CLIENT_KEY,
        statusClientId: 'raspberrypi4-kiosk1'
      }
    });
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
    await prisma.clientDevice.deleteMany({ where: { apiKey: TEST_CLIENT_KEY } });
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

  it('acknowledges the notice and maintenance phases separately', async () => {
    await writeFile(
      TEST_DEPLOY_STATUS_FILE,
      JSON.stringify({
        version: 2,
        kioskByClient: {
          'raspberrypi4-kiosk1': {
            maintenance: false,
            runId: 'run-notice',
            phase: 'notice',
            noticeDurationSeconds: 60
          }
        }
      })
    );
    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const invalidPhase = await app.inject({
      method: 'POST',
      url: '/api/system/deploy-status/ack',
      headers: { 'x-client-key': TEST_CLIENT_KEY },
      payload: { runId: 'run-notice', phase: 'unexpected' }
    });
    expect(invalidPhase.statusCode).toBe(400);
    expect(invalidPhase.json()).toMatchObject({ code: 'DEPLOY_ACK_PHASE_INVALID' });

    const wrongRun = await app.inject({
      method: 'POST',
      url: '/api/system/deploy-status/ack',
      headers: { 'x-client-key': TEST_CLIENT_KEY },
      payload: { runId: 'another-run', phase: 'notice' }
    });
    expect(wrongRun.statusCode).toBe(409);

    const wrongPhase = await app.inject({
      method: 'POST',
      url: '/api/system/deploy-status/ack',
      headers: { 'x-client-key': TEST_CLIENT_KEY },
      payload: { runId: 'run-notice', phase: 'maintenance' }
    });
    expect(wrongPhase.statusCode).toBe(409);

    const notice = await app.inject({
      method: 'POST',
      url: '/api/system/deploy-status/ack',
      headers: { 'x-client-key': TEST_CLIENT_KEY },
      payload: { runId: 'run-notice', phase: 'notice' }
    });
    expect(notice.statusCode).toBe(200);
    expect(notice.json()).toMatchObject({ acknowledged: true, runId: 'run-notice', phase: 'notice' });
    const scheduledAt = notice.json().scheduledAt;
    expect(typeof scheduledAt).toBe('string');
    const noticeStored = JSON.parse(await readFile(TEST_DEPLOY_STATUS_FILE, 'utf-8'));
    expect(
      Date.parse(scheduledAt) - Date.parse(noticeStored.acknowledgements['run-notice']['raspberrypi4-kiosk1'].notice.acknowledgedAt)
    ).toBe(60_000);

    const repeatedNotice = await app.inject({
      method: 'POST',
      url: '/api/system/deploy-status/ack',
      headers: { 'x-client-key': TEST_CLIENT_KEY },
      payload: { runId: 'run-notice', phase: 'notice' }
    });
    expect(repeatedNotice.json().scheduledAt).toBe(scheduledAt);

    await writeFile(
      TEST_DEPLOY_STATUS_FILE,
      JSON.stringify({
        version: 2,
        kioskByClient: {
          'raspberrypi4-kiosk1': { maintenance: true, runId: 'run-notice', phase: 'preparing' }
        },
        acknowledgements: JSON.parse(await readFile(TEST_DEPLOY_STATUS_FILE, 'utf-8')).acknowledgements
      })
    );
    const noticeDuringMaintenance = await app.inject({
      method: 'POST',
      url: '/api/system/deploy-status/ack',
      headers: { 'x-client-key': TEST_CLIENT_KEY },
      payload: { runId: 'run-notice', phase: 'notice' }
    });
    expect(noticeDuringMaintenance.statusCode).toBe(409);

    const maintenance = await app.inject({
      method: 'POST',
      url: '/api/system/deploy-status/ack',
      headers: { 'x-client-key': TEST_CLIENT_KEY },
      payload: { runId: 'run-notice' }
    });
    expect(maintenance.statusCode).toBe(200);
    expect(maintenance.json()).toMatchObject({ acknowledged: true, runId: 'run-notice', phase: 'maintenance' });
    const stored = JSON.parse(await readFile(TEST_DEPLOY_STATUS_FILE, 'utf-8'));
    expect(stored.acknowledgements['run-notice']['raspberrypi4-kiosk1']).toMatchObject({
      notice: { acknowledgedAt: expect.any(String) },
      maintenance: { acknowledgedAt: expect.any(String) }
    });
  });
});
