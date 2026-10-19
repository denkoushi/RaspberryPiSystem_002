import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupConfigSchema } from '../backup-config.js';
import type { BackupExecutionResult } from '../backup-execution.service.js';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  load: vi.fn(),
  createTarget: vi.fn(),
  execute: vi.fn(),
  cleanup: vi.fn(),
  alertCreate: vi.fn(),
  deliveryCreate: vi.fn(),
  transaction: vi.fn(),
  warn: vi.fn()
}));

vi.mock('node-cron', () => ({ default: { validate: () => true, schedule: mocks.schedule } }));
vi.mock('../backup-config.loader.js', () => ({ BackupConfigLoader: { load: mocks.load } }));
vi.mock('../backup-target-factory.js', () => ({ BackupTargetFactory: { createFromConfig: mocks.createTarget } }));
vi.mock('../backup.service.js', () => ({ BackupService: vi.fn() }));
vi.mock('../backup-history.service.js', () => ({ BackupHistoryService: vi.fn() }));
vi.mock('../backup-execution.service.js', () => ({
  executeBackupAcrossProviders: mocks.execute,
  resolveBackupProviders: () => ['local', 'dropbox']
}));
vi.mock('../post-backup-cleanup.service.js', () => ({ cleanupBackupsAfterManualExecution: mocks.cleanup }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: mocks.warn } }));

import { BackupScheduler } from '../backup-scheduler.js';

const secret = 'PRIVATE_TOKEN_personal-name';
const config = () => BackupConfigSchema.parse({
  storage: { provider: 'dropbox', options: { dropbox: { accessToken: secret } } },
  targets: [{
    kind: 'directory', source: `/home/${secret}/backup`, enabled: true, schedule: '0 4 * * *',
    metadata: { label: secret }, storage: { providers: ['local', 'dropbox'] }
  }]
});

async function scheduledRun(): Promise<() => Promise<void>> {
  const scheduler = new BackupScheduler();
  await scheduler.start();
  expect(mocks.schedule).toHaveBeenCalledTimes(1);
  return mocks.schedule.mock.calls[0][1] as () => Promise<void>;
}

function createdAlert() {
  expect(mocks.alertCreate).toHaveBeenCalledTimes(1);
  expect(mocks.deliveryCreate).toHaveBeenCalledTimes(1);
  expect(mocks.deliveryCreate).toHaveBeenCalledWith({ data: {
    alertId: 'alert-id', channel: 'SLACK', routeKey: 'ops', status: 'PENDING', attemptCount: 0
  } });
  const alert = mocks.alertCreate.mock.calls[0][0].data;
  expect(JSON.stringify(alert)).not.toContain(secret);
  expect(JSON.stringify(alert)).not.toContain('/home/');
  return alert;
}

describe('BackupScheduler failure alerts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.schedule.mockReturnValue({ stop: vi.fn() });
    mocks.load.mockResolvedValue(config());
    mocks.createTarget.mockReturnValue({});
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.alertCreate.mockResolvedValue({ id: 'alert-id' });
    mocks.deliveryCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({
      alert: { create: mocks.alertCreate }, alertDelivery: { create: mocks.deliveryCreate }
    }));
  });

  it('does not alert on success and still cleans up', async () => {
    mocks.execute.mockResolvedValue({ results: [{ provider: 'dropbox', success: true, path: secret }] });
    await (await scheduledRun())();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it.each([
    { results: [{ provider: 'dropbox', success: false, error: secret }] },
    { results: [
      { provider: 'local', success: false, error: secret },
      { provider: 'dropbox', success: false, error: secret }
    ] }
  ] satisfies { results: BackupExecutionResult[] }[])('alerts once when all providers fail: $results', async ({ results }) => {
    mocks.execute.mockResolvedValue({ results });
    await (await scheduledRun())();
    expect(createdAlert()).toMatchObject({ severity: 'ERROR', details: {
      targetKind: 'directory', failureType: 'all-providers-failed',
      providerCount: results.length, failedProviderCount: results.length,
      failedProviders: results.map((result) => result.provider)
    } });
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it('alerts once on partial failure and still cleans up', async () => {
    mocks.execute.mockResolvedValue({ results: [
      { provider: 'local', success: true, path: secret },
      { provider: 'dropbox', success: false, error: secret }
    ] });
    await (await scheduledRun())();
    expect(createdAlert()).toMatchObject({ severity: 'WARNING', details: {
      targetKind: 'directory', failureType: 'partial-providers-failed',
      providerCount: 2, failedProviderCount: 1, failedProviders: ['dropbox']
    } });
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it('alerts once when scheduled execution throws without exposing the error', async () => {
    mocks.execute.mockRejectedValue(new Error(`token=${secret}; path=/home/${secret}/backup`));
    await (await scheduledRun())();
    expect(createdAlert()).toMatchObject({ details: { targetKind: 'directory', failureType: 'execution-failed' } });
  });

  it('alerts on target construction failure', async () => {
    mocks.createTarget.mockImplementation(() => { throw new Error(secret); });
    await (await scheduledRun())();
    expect(createdAlert().details.failureType).toBe('execution-failed');
  });

  it('alerts once if cleanup throws after partial failure', async () => {
    mocks.execute.mockResolvedValue({ results: [
      { provider: 'local', success: true }, { provider: 'dropbox', success: false, error: secret }
    ] });
    mocks.cleanup.mockRejectedValue(new Error(secret));
    await (await scheduledRun())();
    expect(createdAlert().details.failureType).toBe('execution-failed');
  });

  it('uses a stable fingerprint for repeat failures without storing the target source', async () => {
    mocks.execute.mockResolvedValue({ results: [{ provider: 'dropbox', success: false, error: secret }] });
    const run = await scheduledRun();
    await run();
    await run();
    const [first, second] = mocks.alertCreate.mock.calls.map(([call]) => call.data);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.id).not.toBe(first.id);
    expect(JSON.stringify(mocks.alertCreate.mock.calls)).not.toContain(secret);
  });

  it('distinguishes different targets of the same kind in the fingerprint', async () => {
    mocks.execute.mockResolvedValue({ results: [{ provider: 'dropbox', success: false }] });
    await (await scheduledRun())();
    const other = config();
    other.targets[0].source = `/home/${secret}/other`;
    mocks.load.mockResolvedValue(other);
    mocks.schedule.mockClear();
    await (await scheduledRun())();
    expect(mocks.alertCreate.mock.calls[1][0].data.fingerprint)
      .not.toBe(mocks.alertCreate.mock.calls[0][0].data.fingerprint);
  });

  it('keeps the scheduled callback usable when alert delivery creation fails', async () => {
    mocks.execute.mockRejectedValue(new Error(secret));
    mocks.deliveryCreate.mockRejectedValue(new Error(secret));
    const run = await scheduledRun();
    await expect(run()).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith('[BackupScheduler] Failed to enqueue backup failure alert');
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(secret);
    await expect(run()).resolves.toBeUndefined();
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
});
