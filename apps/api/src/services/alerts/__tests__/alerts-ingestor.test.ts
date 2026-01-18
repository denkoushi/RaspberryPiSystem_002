import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { AlertSeverity, AlertChannel, AlertDeliveryStatus } from '@prisma/client';

// Prismaのモック（AlertsIngestorのインポート前にモックを設定）
const mockAlertUpsert = vi.hoisted(() => vi.fn());
const mockAlertDeliveryUpsert = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    alert: {
      upsert: mockAlertUpsert,
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    alertDelivery: {
      upsert: mockAlertDeliveryUpsert
    }
  }
}));

// alerts-configのモック（loadAlertsDispatcherConfigとresolveRouteKey）
const mockLoadAlertsDispatcherConfig = vi.hoisted(() => vi.fn());
const mockResolveRouteKey = vi.hoisted(() =>
  vi.fn((type: string | undefined) => {
    if (!type) return 'ops';
    if (type.startsWith('ansible-update-')) return 'deploy';
    if (type.startsWith('storage-')) return 'ops';
    return 'ops';
  })
);

vi.mock('../alerts-config.js', () => ({
  loadAlertsDispatcherConfig: mockLoadAlertsDispatcherConfig,
  resolveRouteKey: mockResolveRouteKey,
  AlertsRouteKey: {}
}));

import { AlertsIngestor } from '../alerts-ingestor.js';

async function writeAlert(dir: string, name: string, alert: unknown) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), JSON.stringify(alert, null, 2), 'utf-8');
}

describe('AlertsIngestor (Phase2)', () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAlertUpsert.mockClear();
    mockAlertDeliveryUpsert.mockClear();
    mockLoadAlertsDispatcherConfig.mockClear();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alerts-ingestor-'));
    process.env.ALERTS_DIR = tmpDir;
    process.env.ALERTS_DB_INGEST_ENABLED = 'true';
    process.env.ALERTS_DB_INGEST_INTERVAL_SECONDS = '60';
    process.env.ALERTS_DB_INGEST_LIMIT = '50';

    // loadAlertsDispatcherConfigのモックを設定（各テストで上書き可能）
    mockLoadAlertsDispatcherConfig.mockResolvedValue({
      enabled: false,
      intervalSeconds: 30,
      maxAttempts: 5,
      retryDelaySeconds: 60,
      webhookTimeoutMs: 5000,
      alertsDir: tmpDir,
      slack: {
        enabled: true,
        webhooks: {}
      },
      routing: {
        byTypePrefix: {
          'ansible-update-': 'deploy',
          'storage-': 'ops'
        },
        defaultRoute: 'ops'
      }
    });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('ingests new alert into DB', async () => {
    const alertId = '20260118-000000';
    const timestamp = new Date().toISOString();

    await writeAlert(tmpDir, `alert-${alertId}.json`, {
      id: alertId,
      type: 'ansible-update-started',
      severity: 'info',
      message: 'Ansible更新を開始しました',
      details: { test: 'data' },
      timestamp,
      acknowledged: false
    });

    mockAlertUpsert.mockResolvedValue({
      id: alertId,
      type: 'ansible-update-started',
      severity: AlertSeverity.INFO,
      message: 'Ansible更新を開始しました',
      details: { test: 'data' },
      source: null,
      context: null,
      fingerprint: null,
      timestamp: new Date(timestamp),
      acknowledged: false,
      acknowledgedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    mockAlertDeliveryUpsert.mockResolvedValue({
      id: 'delivery-1',
      alertId,
      channel: AlertChannel.SLACK,
      routeKey: 'deploy',
      status: AlertDeliveryStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      sentAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    const ingestor = new AlertsIngestor();
    await ingestor.ingestOnceNow();

    expect(mockAlertUpsert).toHaveBeenCalledTimes(1);
    const alertCall = mockAlertUpsert.mock.calls[0][0];
    expect(alertCall.where.id).toBe(alertId);
    expect(alertCall.create.id).toBe(alertId);
    expect(alertCall.create.type).toBe('ansible-update-started');
    expect(alertCall.create.severity).toBe(AlertSeverity.INFO);

    expect(mockAlertDeliveryUpsert).toHaveBeenCalledTimes(1);
    const deliveryCall = mockAlertDeliveryUpsert.mock.calls[0][0];
    expect(deliveryCall.where.alertId_channel_routeKey.alertId).toBe(alertId);
    expect(deliveryCall.where.alertId_channel_routeKey.channel).toBe(AlertChannel.SLACK);
    expect(deliveryCall.where.alertId_channel_routeKey.routeKey).toBe('deploy');
    expect(deliveryCall.create.status).toBe(AlertDeliveryStatus.PENDING);
  });

  it('does not create duplicate alerts (upsert)', async () => {
    const alertId = '20260118-000001';
    const timestamp = new Date().toISOString();

    await writeAlert(tmpDir, `alert-${alertId}.json`, {
      id: alertId,
      type: 'storage-usage-high',
      message: 'ストレージ使用量が高いです',
      timestamp,
      acknowledged: false
    });

    mockAlertUpsert.mockResolvedValue({
      id: alertId,
      type: 'storage-usage-high',
      severity: null,
      message: 'ストレージ使用量が高いです',
      details: null,
      source: null,
      context: null,
      fingerprint: null,
      timestamp: new Date(timestamp),
      acknowledged: false,
      acknowledgedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    mockAlertDeliveryUpsert.mockResolvedValue({
      id: 'delivery-1',
      alertId,
      channel: AlertChannel.SLACK,
      routeKey: 'ops',
      status: AlertDeliveryStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      sentAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    const ingestor = new AlertsIngestor();
    await ingestor.ingestOnceNow();

    // 2回目も実行しても、upsertなので重複作成されない
    await ingestor.ingestOnceNow();

    // upsertは2回呼ばれるが、createではなくupdateになる
    expect(mockAlertUpsert).toHaveBeenCalledTimes(2);
  });

  it('skips alerts without id', async () => {
    await writeAlert(tmpDir, 'alert-invalid.json', {
      type: 'test-alert',
      message: 'IDなしアラート',
      timestamp: new Date().toISOString(),
      acknowledged: false
    });

    const ingestor = new AlertsIngestor();
    await ingestor.ingestOnceNow();

    expect(mockAlertUpsert).not.toHaveBeenCalled();
  });

  it('skips alerts without timestamp', async () => {
    await writeAlert(tmpDir, 'alert-20260118-000002.json', {
      id: '20260118-000002',
      type: 'test-alert',
      message: 'タイムスタンプなしアラート',
      acknowledged: false
    });

    const ingestor = new AlertsIngestor();
    await ingestor.ingestOnceNow();

    expect(mockAlertUpsert).not.toHaveBeenCalled();
  });

  it('skips invalid JSON files', async () => {
    await fs.writeFile(path.join(tmpDir, 'alert-invalid.json'), 'invalid json content', 'utf-8');

    const ingestor = new AlertsIngestor();
    await ingestor.ingestOnceNow();

    expect(mockAlertUpsert).not.toHaveBeenCalled();
  });

  it('handles string details as JSON object', async () => {
    const alertId = '20260118-000003';
    const timestamp = new Date().toISOString();

    await writeAlert(tmpDir, `alert-${alertId}.json`, {
      id: alertId,
      type: 'test-alert',
      message: 'テスト',
      details: '文字列のdetails',
      timestamp,
      acknowledged: false
    });

    mockAlertUpsert.mockResolvedValue({
      id: alertId,
      type: 'test-alert',
      severity: null,
      message: 'テスト',
      details: { raw: '文字列のdetails' },
      source: null,
      context: null,
      fingerprint: null,
      timestamp: new Date(timestamp),
      acknowledged: false,
      acknowledgedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    mockAlertDeliveryUpsert.mockResolvedValue({
      id: 'delivery-1',
      alertId,
      channel: AlertChannel.SLACK,
      routeKey: 'ops',
      status: AlertDeliveryStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      sentAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    const ingestor = new AlertsIngestor();
    await ingestor.ingestOnceNow();

    expect(mockAlertUpsert).toHaveBeenCalledTimes(1);
    const alertCall = mockAlertUpsert.mock.calls[0][0];
    expect(alertCall.create.details).toEqual({ raw: '文字列のdetails' });
  });
});
