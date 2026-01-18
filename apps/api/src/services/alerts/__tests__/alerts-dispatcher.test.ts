import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { AlertsDispatcher } from '../alerts-dispatcher.js';

// fetchをモック
global.fetch = vi.fn();

async function writeAlert(dir: string, name: string, alert: unknown) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), JSON.stringify(alert, null, 2), 'utf-8');
}

describe('AlertsDispatcher (Phase1)', () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alerts-dispatcher-'));
    process.env.ALERTS_DIR = tmpDir;
    process.env.ALERTS_DISPATCHER_ENABLED = 'true';
    process.env.ALERTS_DISPATCHER_INTERVAL_SECONDS = '30';
    process.env.ALERTS_DISPATCHER_MAX_ATTEMPTS = '5';
    process.env.ALERTS_DISPATCHER_RETRY_DELAY_SECONDS = '60';
    process.env.ALERTS_DISPATCHER_WEBHOOK_TIMEOUT_MS = '5000';

    // deploy route webhook only (ansible-update-* -> deploy)
    process.env.ALERTS_SLACK_WEBHOOK_DEPLOY = 'https://hooks.slack.com/services/TEST/DEPLOY';
    delete process.env.ALERTS_SLACK_WEBHOOK_OPS;
    delete process.env.ALERTS_SLACK_WEBHOOK_SUPPORT;
    delete process.env.ALERTS_SLACK_WEBHOOK_SECURITY;

    delete process.env.ALERTS_CONFIG_PATH;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('sends Slack once and persists delivery state', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, status: 200 });

    await writeAlert(tmpDir, 'alert-20260118-000000.json', {
      id: '20260118-000000',
      type: 'ansible-update-started',
      message: 'Ansible更新を開始しました',
      details: 'test',
      timestamp: new Date().toISOString(),
      acknowledged: false
    });

    const dispatcher = new AlertsDispatcher();
    await dispatcher.runOnceNow();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(process.env.ALERTS_SLACK_WEBHOOK_DEPLOY);

    const content = await fs.readFile(path.join(tmpDir, 'alert-20260118-000000.json'), 'utf-8');
    const saved = JSON.parse(content);
    expect(saved.deliveries?.slack?.deploy?.status).toBe('sent');

    // second run should not re-send
    await dispatcher.runOnceNow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('records failures and does not retry before retryDelaySeconds', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    await writeAlert(tmpDir, 'alert-20260118-000001.json', {
      id: '20260118-000001',
      type: 'ansible-update-started',
      message: 'Ansible更新を開始しました',
      timestamp: new Date().toISOString(),
      acknowledged: false
    });

    const dispatcher = new AlertsDispatcher();
    await dispatcher.runOnceNow();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // immediate second run should not retry (retryDelaySeconds=60)
    await dispatcher.runOnceNow();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const content = await fs.readFile(path.join(tmpDir, 'alert-20260118-000001.json'), 'utf-8');
    const saved = JSON.parse(content);
    expect(saved.deliveries?.slack?.deploy?.status).toBe('failed');
    expect(saved.deliveries?.slack?.deploy?.attempts).toBe(1);
  });

  it('does not send old alerts (older than 24 hours)', async () => {
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25時間前

    await writeAlert(tmpDir, 'alert-20260117-000000.json', {
      id: '20260117-000000',
      type: 'ansible-update-started',
      message: '古いアラート',
      timestamp: oldTimestamp,
      acknowledged: false
    });

    const dispatcher = new AlertsDispatcher();
    await dispatcher.runOnceNow();

    // 過去のアラートは送信されない
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends recent alerts (within 24 hours)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, status: 200 });

    const recentTimestamp = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1時間前

    await writeAlert(tmpDir, 'alert-20260118-000002.json', {
      id: '20260118-000002',
      type: 'ansible-update-started',
      message: '最近のアラート',
      timestamp: recentTimestamp,
      acknowledged: false
    });

    const dispatcher = new AlertsDispatcher();
    await dispatcher.runOnceNow();

    // 最近のアラートは送信される
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

