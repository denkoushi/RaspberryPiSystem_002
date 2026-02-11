import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestClientDevice, createTestUser } from './helpers.js';
import { AlertSeverity } from '@prisma/client';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('PUT /api/clients/:id', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let clientId: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const client = await createTestClientDevice();
    clientId = client.id;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should update defaultMode to PHOTO', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${clientId}`,
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        defaultMode: 'PHOTO',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.client.defaultMode).toBe('PHOTO');
  });

  it('should update defaultMode to TAG', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${clientId}`,
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        defaultMode: 'TAG',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.client.defaultMode).toBe('TAG');
  });

  it('should update client name with trimmed value', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${clientId}`,
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: '  受付キオスク  '
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.client.name).toBe('受付キオスク');
  });

  it('should return 404 for non-existent client', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${nonExistentId}`,
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        defaultMode: 'PHOTO',
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${clientId}`,
      headers: { 'Content-Type': 'application/json' },
      payload: {
        defaultMode: 'PHOTO',
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('クライアントテレメトリーAPI', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let clientKey: string;
  let clientName: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    await prisma.clientLog.deleteMany();
    await prisma.clientStatus.deleteMany();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const client = await createTestClientDevice();
    clientKey = client.apiKey;
    clientName = client.name;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('POST /api/clients/status stores metrics and logs', async () => {
    const payload = {
      clientId: `pi-${Date.now()}`,
      hostname: 'pi-kiosk-01',
      ipAddress: '192.168.0.30',
      cpuUsage: 25.4,
      memoryUsage: 44.1,
      diskUsage: 70.2,
      temperature: 48.5,
      uptimeSeconds: 3600,
      lastBoot: new Date().toISOString(),
      logs: [
        { level: 'INFO', message: 'Signage refreshed' },
        { level: 'WARN', message: 'CPU temp high', context: { temp: 65 } }
      ]
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/status',
      headers: {
        'x-client-key': clientKey,
        'Content-Type': 'application/json'
      },
      payload
    });

    expect(response.statusCode).toBe(200);

    const statusRecord = await prisma.clientStatus.findUnique({
      where: { clientId: payload.clientId }
    });
    expect(statusRecord).toBeTruthy();
    expect(statusRecord?.cpuUsage).toBeCloseTo(payload.cpuUsage);

    const logRecords = await prisma.clientLog.findMany({
      where: { clientId: payload.clientId }
    });
    expect(logRecords).toHaveLength(2);
  });

  it('POST /api/clients/status updates ClientDevice.statusClientId', async () => {
    const statusClientId = `pi-status-${Date.now()}`;
    const payload = {
      clientId: statusClientId,
      hostname: 'pi-kiosk-02',
      ipAddress: '192.168.0.31',
      cpuUsage: 30.0,
      memoryUsage: 50.0,
      diskUsage: 60.0,
      temperature: 50.0
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/status',
      headers: {
        'x-client-key': clientKey,
        'Content-Type': 'application/json'
      },
      payload
    });

    expect(response.statusCode).toBe(200);

    // ClientDeviceのstatusClientIdが更新されていることを確認
    const clientDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey }
    });
    expect(clientDevice).toBeTruthy();
    expect(clientDevice?.statusClientId).toBe(statusClientId);

    // 再度送信して、statusClientIdが更新されることを確認
    const newStatusClientId = `pi-status-updated-${Date.now()}`;
    const updatedPayload = {
      ...payload,
      clientId: newStatusClientId
    };

    await app.inject({
      method: 'POST',
      url: '/api/clients/status',
      headers: {
        'x-client-key': clientKey,
        'Content-Type': 'application/json'
      },
      payload: updatedPayload
    });

    const updatedClientDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey }
    });
    expect(updatedClientDevice?.statusClientId).toBe(newStatusClientId);
  });

  it('POST /api/clients/status does not overwrite ClientDevice.name', async () => {
    const payload = {
      clientId: `pi-status-${Date.now()}`,
      hostname: 'pi-updated-hostname',
      ipAddress: '192.168.0.51',
      cpuUsage: 12.3,
      memoryUsage: 23.4,
      diskUsage: 34.5
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/status',
      headers: {
        'x-client-key': clientKey,
        'Content-Type': 'application/json'
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    const clientDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey }
    });
    expect(clientDevice?.name).toBe(clientName);
    expect(clientDevice?.statusClientId).toBe(payload.clientId);
  });

  it('POST /api/clients/heartbeat does not overwrite ClientDevice.name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/heartbeat',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        apiKey: clientKey,
        name: 'Heartbeat Name',
        location: '新しい場所'
      }
    });

    expect(response.statusCode).toBe(200);
    const clientDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey }
    });
    expect(clientDevice?.name).toBe(clientName);
    expect(clientDevice?.location).toBe('新しい場所');
  });

  it('GET /api/clients/status requires auth and returns latest logs', async () => {
    const clientId = `pi-${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/api/clients/status',
      headers: { 'x-client-key': clientKey, 'Content-Type': 'application/json' },
      payload: {
        clientId,
        hostname: 'pi-kiosk-02',
        ipAddress: '192.168.0.31',
        cpuUsage: 15,
        memoryUsage: 22,
        diskUsage: 55,
        logs: [{ level: 'INFO', message: 'ok' }]
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/clients/status',
      headers: { ...createAuthHeader(adminToken) }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const target = body.clients.find((c: { clientId: string }) => c.clientId === clientId);
    expect(target).toBeTruthy();
    const latestLogs = (target as { latestLogs?: unknown[] } | undefined)?.latestLogs ?? [];
    expect(Array.isArray(latestLogs)).toBe(true);
    expect(latestLogs.length).toBeGreaterThan(0);
  });

  it('POST /api/clients/logs stores entries independently', async () => {
    const clientId = `pi-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/logs',
      headers: { 'x-client-key': clientKey, 'Content-Type': 'application/json' },
      payload: {
        clientId,
        logs: [
          { level: 'DEBUG', message: 'start' },
          { level: 'ERROR', message: 'failed' }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    const logs = await prisma.clientLog.findMany({ where: { clientId } });
    expect(logs).toHaveLength(2);
  });

  it('GET /api/clients/logs filters by clientId', async () => {
    const clientId = `pi-${Date.now()}`;
    await prisma.clientLog.createMany({
      data: [
        { clientId, level: 'INFO', message: 'hello' },
        { clientId, level: 'WARN', message: 'be careful' },
        { clientId: 'others', level: 'INFO', message: 'skip' }
      ]
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/clients/logs?clientId=${clientId}&limit=5`,
      headers: { ...createAuthHeader(adminToken) }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.logs).toHaveLength(2);
    expect(body.logs.every((log: { clientId: string }) => log.clientId === clientId)).toBe(true);
  });

  it('POST /api/clients/status requires x-client-key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/status',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        clientId: 'pi-missing',
        hostname: 'pi',
        ipAddress: '192.168.0.1',
        cpuUsage: 10,
        memoryUsage: 10,
        diskUsage: 10
      }
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('Alerts API (Phase2完全移行: DBのみ参照)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    await prisma.alertDelivery.deleteMany();
    await prisma.alert.deleteMany();
    await prisma.clientStatus.deleteMany();
    await prisma.clientLog.deleteMany();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const viewer = await createTestUser('VIEWER');
    viewerToken = viewer.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('GET /api/clients/alerts returns dbAlerts and empty fileAlerts', async () => {
    // 未acknowledgedのAlertを作成
    const alert1 = await prisma.alert.create({
      data: {
        id: 'test-alert-1',
        type: 'test-alert',
        message: 'Test alert 1',
        severity: AlertSeverity.WARNING,
        timestamp: new Date(),
        acknowledged: false
      }
    });

    const alert2 = await prisma.alert.create({
      data: {
        id: 'test-alert-2',
        type: 'test-alert-2',
        message: 'Test alert 2',
        severity: AlertSeverity.ERROR,
        timestamp: new Date(),
        acknowledged: false
      }
    });

    // acknowledgedのAlertは返されない
    await prisma.alert.create({
      data: {
        id: 'test-alert-ack',
        type: 'test-alert-ack',
        message: 'Acknowledged alert',
        timestamp: new Date(),
        acknowledged: true,
        acknowledgedAt: new Date()
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/clients/alerts',
      headers: { ...createAuthHeader(viewerToken) }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.alerts.dbAlerts).toBe(2);
    expect(body.alerts.fileAlerts).toBe(0); // deprecated: 常に0
    expect(body.details.dbAlerts).toHaveLength(2);
    expect(body.details.fileAlerts).toHaveLength(0); // deprecated: 常に空配列
    expect(body.details.dbAlerts.find((a: { id: string }) => a.id === alert1.id)).toBeTruthy();
    expect(body.details.dbAlerts.find((a: { id: string }) => a.id === alert2.id)).toBeTruthy();
    expect(body.details.dbAlerts.find((a: { id: string }) => a.id === 'test-alert-ack')).toBeFalsy();
  });

  it('POST /api/clients/alerts/:id/acknowledge updates DB only', async () => {
    const alert = await prisma.alert.create({
      data: {
        id: 'test-alert-ack-1',
        type: 'test-alert',
        message: 'Test alert to acknowledge',
        timestamp: new Date(),
        acknowledged: false
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/clients/alerts/${alert.id}/acknowledge`,
      headers: { ...createAuthHeader(adminToken) }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.acknowledged).toBe(true);
    expect(body.acknowledgedInDb).toBe(true);

    // DB上でacknowledgedがtrueになっていることを確認
    const updatedAlert = await prisma.alert.findUnique({
      where: { id: alert.id }
    });
    expect(updatedAlert?.acknowledged).toBe(true);
    expect(updatedAlert?.acknowledgedAt).toBeTruthy();

    // 次回のGETで返されないことを確認
    const getResponse = await app.inject({
      method: 'GET',
      url: '/api/clients/alerts',
      headers: { ...createAuthHeader(viewerToken) }
    });
    const getBody = getResponse.json();
    expect(getBody.details.dbAlerts.find((a: { id: string }) => a.id === alert.id)).toBeFalsy();
  });

  it('POST /api/clients/alerts/:id/acknowledge returns 404 for non-existent alert', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/alerts/non-existent-id/acknowledge',
      headers: { ...createAuthHeader(adminToken) }
    });

    expect(response.statusCode).toBe(404);
  });

  it('POST /api/clients/alerts/:id/acknowledge is idempotent (already acknowledged)', async () => {
    const alert = await prisma.alert.create({
      data: {
        id: 'test-alert-ack-2',
        type: 'test-alert',
        message: 'Already acknowledged',
        timestamp: new Date(),
        acknowledged: true,
        acknowledgedAt: new Date()
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/clients/alerts/${alert.id}/acknowledge`,
      headers: { ...createAuthHeader(adminToken) }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.acknowledged).toBe(true);
    expect(body.acknowledgedInDb).toBe(true);
  });

  it('POST /api/clients/alerts/:id/acknowledge requires ADMIN or MANAGER role', async () => {
    const alert = await prisma.alert.create({
      data: {
        id: 'test-alert-ack-3',
        type: 'test-alert',
        message: 'Test alert',
        timestamp: new Date(),
        acknowledged: false
      }
    });

    // VIEWERはacknowledgeできない
    const viewerResponse = await app.inject({
      method: 'POST',
      url: `/api/clients/alerts/${alert.id}/acknowledge`,
      headers: { ...createAuthHeader(viewerToken) }
    });

    expect(viewerResponse.statusCode).toBe(403);
  });
});

