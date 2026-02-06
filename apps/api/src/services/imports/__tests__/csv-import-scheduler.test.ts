import { beforeEach, describe, expect, it, vi } from 'vitest';

// node-cronをモックして、登録されたcallbackを明示的に実行できるようにする
const callbacksBySchedule = new Map<string, Array<() => unknown>>();
const scheduleMock = vi.fn((schedule: string, callback: () => unknown) => {
  const list = callbacksBySchedule.get(schedule) ?? [];
  list.push(callback);
  callbacksBySchedule.set(schedule, list);
  return { stop: vi.fn() };
});
const validateMock = vi.fn((schedule: string) => schedule !== 'invalid');

vi.mock('node-cron', () => ({
  default: { schedule: scheduleMock },
  schedule: scheduleMock,
  validate: validateMock,
}));

// BackupConfigLoader.loadを最小限モック
const loadMock = vi.fn();
vi.mock('../../backup/backup-config.loader.js', () => ({
  BackupConfigLoader: { load: (...args: any[]) => loadMock(...args) },
}));

// noisy logsを抑制
vi.mock('../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Prismaのモック（Gmail OAuth expired alertテスト用）
const mockCreateAlert = vi.fn();
const mockCreateAlertDelivery = vi.fn();
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    alert: {
      create: mockCreateAlert,
    },
    alertDelivery: {
      create: mockCreateAlertDelivery,
    },
  },
}));

// alerts-configのモック
vi.mock('../../alerts/alerts-config.js', async () => {
  const actual = await vi.importActual('../../alerts/alerts-config.js');
  return {
    ...actual,
    loadAlertsDispatcherConfig: vi.fn().mockResolvedValue({
      routing: {
        byTypePrefix: {
          'gmail-oauth-': 'ops',
        },
        defaultRoute: 'ops',
      },
    }),
    resolveRouteKey: vi.fn((type: string) => {
      if (type?.startsWith('gmail-oauth-')) return 'ops';
      return 'ops';
    }),
  };
});

describe('CsvImportScheduler (DI-friendly)', () => {
  beforeEach(() => {
    callbacksBySchedule.clear();
    scheduleMock.mockClear();
    validateMock.mockClear();
    loadMock.mockReset();
    mockCreateAlert.mockReset();
    mockCreateAlertDelivery.mockReset();
  });

  it('should register cron tasks (import + cleanup + retention)', async () => {
    const { CsvImportScheduler } = await import('../csv-import-scheduler.js');

    loadMock.mockResolvedValue({
      storage: { provider: 'dropbox', options: { dropbox: { accessToken: 'dummy' } } },
      csvImportHistory: { retentionDays: 90, cleanupSchedule: '0 2 * * *' },
      csvImports: [
        {
          id: 'test-1',
          name: 'Test Import',
          targets: [{ type: 'employees', source: '/backups/csv/employees.csv' }],
          schedule: '0 4 * * *',
          enabled: true,
          replaceExisting: false,
        },
      ],
    });

    const scheduler = new CsvImportScheduler({
      // ここはstart内では実行されないので最低限でよい
      createExecutionService: () => ({ execute: vi.fn() } as any),
    });

    await scheduler.start();

    // import schedule + cleanup schedule + retention schedule が登録される
    expect(validateMock).toHaveBeenCalledWith('0 4 * * *');
    expect(scheduleMock).toHaveBeenCalledWith('0 4 * * *', expect.any(Function), expect.any(Object));
    expect(scheduleMock).toHaveBeenCalledWith('0 2 * * *', expect.any(Function), expect.any(Object));
    expect(scheduleMock).toHaveBeenCalledWith('0 2 1 * *', expect.any(Function), expect.any(Object));
  });

  it('scheduled execution should call execution service and auto backup', async () => {
    const { CsvImportScheduler } = await import('../csv-import-scheduler.js');

    loadMock.mockResolvedValue({
      storage: { provider: 'dropbox', options: { dropbox: { accessToken: 'dummy' } } },
      csvImports: [
        {
          id: 'test-1',
          name: 'Test Import',
          targets: [{ type: 'employees', source: '/backups/csv/employees.csv' }],
          schedule: '0 4 * * *',
          enabled: true,
          replaceExisting: false,
          autoBackupAfterImport: { enabled: true, targets: ['csv'] },
        },
      ],
    });

    const mockCreateHistory = vi.fn().mockResolvedValue('history-1');
    const mockCompleteHistory = vi.fn().mockResolvedValue(undefined);
    const mockFailHistory = vi.fn().mockResolvedValue(undefined);

    const mockGenerateFailureAlert = vi.fn().mockResolvedValue(undefined);
    const mockGenerateConsecutiveFailureAlert = vi.fn().mockResolvedValue(undefined);

    const executionExecute = vi.fn().mockResolvedValue({
      employees: { processed: 1, created: 1, updated: 0 },
    });
    const autoBackupExecute = vi.fn().mockResolvedValue(undefined);

    const scheduler = new CsvImportScheduler({
      historyService: {
        createHistory: mockCreateHistory,
        completeHistory: mockCompleteHistory,
        failHistory: mockFailHistory,
        cleanupOldHistory: vi.fn(),
      } as any,
      alertService: {
        generateFailureAlert: mockGenerateFailureAlert,
        generateConsecutiveFailureAlert: mockGenerateConsecutiveFailureAlert,
      } as any,
      createExecutionService: () => ({ execute: executionExecute } as any),
      createAutoBackupService: () => ({ execute: autoBackupExecute } as any),
    });

    await scheduler.start();

    const cb = callbacksBySchedule.get('0 4 * * *')?.[0];
    expect(cb).toBeDefined();
    await cb?.();

    expect(executionExecute).toHaveBeenCalledWith(
      expect.objectContaining({ skipRetry: false })
    );
    expect(mockCreateHistory).toHaveBeenCalled();
    expect(mockCompleteHistory).toHaveBeenCalled();
    expect(autoBackupExecute).toHaveBeenCalled();
    expect(mockGenerateFailureAlert).not.toHaveBeenCalled();
  });

  it('scheduled execution should count consecutive failures and alert on 3rd failure', async () => {
    const { CsvImportScheduler } = await import('../csv-import-scheduler.js');

    loadMock.mockResolvedValue({
      storage: { provider: 'dropbox', options: { dropbox: { accessToken: 'dummy' } } },
      csvImports: [
        {
          id: 'test-1',
          name: 'Test Import',
          targets: [{ type: 'employees', source: '/backups/csv/employees.csv' }],
          schedule: '0 4 * * *',
          enabled: true,
          replaceExisting: false,
        },
      ],
    });

    const executionExecute = vi.fn().mockRejectedValue(new Error('boom'));
    const mockGenerateFailureAlert = vi.fn().mockResolvedValue(undefined);
    const mockGenerateConsecutiveFailureAlert = vi.fn().mockResolvedValue(undefined);

    const scheduler = new CsvImportScheduler({
      historyService: {
        createHistory: vi.fn().mockResolvedValue('history-1'),
        completeHistory: vi.fn(),
        failHistory: vi.fn(),
        cleanupOldHistory: vi.fn(),
      } as any,
      alertService: {
        generateFailureAlert: mockGenerateFailureAlert,
        generateConsecutiveFailureAlert: mockGenerateConsecutiveFailureAlert,
      } as any,
      createExecutionService: () => ({ execute: executionExecute } as any),
    });

    await scheduler.start();
    const cb = callbacksBySchedule.get('0 4 * * *')?.[0];
    expect(cb).toBeDefined();

    await expect(cb?.()).rejects.toThrow('boom');
    await expect(cb?.()).rejects.toThrow('boom');
    await expect(cb?.()).rejects.toThrow('boom');

    expect(mockGenerateFailureAlert).toHaveBeenCalledTimes(3);
    expect(mockGenerateConsecutiveFailureAlert).toHaveBeenCalledTimes(1);
  });

  it('retention cron should call retention service cleanup', async () => {
    const { CsvImportScheduler } = await import('../csv-import-scheduler.js');

    loadMock.mockResolvedValue({
      storage: { provider: 'dropbox', options: { dropbox: { accessToken: 'dummy' } } },
      csvImports: [],
    });

    const cleanup = vi.fn().mockResolvedValue({
      deletedRows: 1,
      deletedIngestRuns: 1,
      deletedFiles: 1,
      deletedSize: 10,
    });

    const scheduler = new CsvImportScheduler({
      createCsvDashboardRetentionService: () => ({ cleanup } as any),
    });

    await scheduler.start();

    const retentionCb = callbacksBySchedule.get('0 2 1 * *')?.[0];
    expect(retentionCb).toBeDefined();
    await retentionCb?.();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('scheduled execution should generate Gmail OAuth expired alert when GmailReauthRequiredError occurs', async () => {
    const { CsvImportScheduler } = await import('../csv-import-scheduler.js');
    const { GmailReauthRequiredError } = await import('../../backup/gmail-oauth.service.js');

    loadMock.mockResolvedValue({
      storage: { provider: 'dropbox', options: { dropbox: { accessToken: 'dummy' } } },
      csvImports: [
        {
          id: 'test-1',
          name: 'Test Import',
          targets: [{ type: 'csvDashboards', source: 'gmail' }],
          schedule: '0 4 * * *',
          enabled: true,
          replaceExisting: false,
        },
      ],
    });

    const executionExecute = vi.fn().mockRejectedValue(new GmailReauthRequiredError('Gmailの再認可が必要です（invalid_grant）'));
    const mockGenerateFailureAlert = vi.fn().mockResolvedValue(undefined);
    mockCreateAlert.mockResolvedValue({ id: 'alert-1' });
    mockCreateAlertDelivery.mockResolvedValue({ id: 'delivery-1' });

    const scheduler = new CsvImportScheduler({
      historyService: {
        createHistory: vi.fn().mockResolvedValue('history-1'),
        completeHistory: vi.fn(),
        failHistory: vi.fn(),
        cleanupOldHistory: vi.fn(),
      } as any,
      alertService: {
        generateFailureAlert: mockGenerateFailureAlert,
        generateConsecutiveFailureAlert: vi.fn(),
      } as any,
      createExecutionService: () => ({ execute: executionExecute } as any),
    });

    await scheduler.start();
    const cb = callbacksBySchedule.get('0 4 * * *')?.[0];
    expect(cb).toBeDefined();

    await expect(cb?.()).rejects.toThrow();

    // 通常の失敗アラートは生成される
    expect(mockGenerateFailureAlert).toHaveBeenCalledTimes(1);
    // Gmail認証切れアラートも生成される（定期実行時のみ）
    expect(mockCreateAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'gmail-oauth-expired',
          message: 'Gmail認証が切れています。管理コンソールの「OAuth認証」を実行してください。',
        }),
      })
    );
    expect(mockCreateAlertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routeKey: 'ops',
          channel: 'SLACK',
          status: 'PENDING',
        }),
      })
    );
  });

  it('manual execution should NOT generate Gmail OAuth expired alert', async () => {
    const { CsvImportScheduler } = await import('../csv-import-scheduler.js');
    const { GmailReauthRequiredError } = await import('../../backup/gmail-oauth.service.js');

    loadMock.mockResolvedValue({
      storage: { provider: 'dropbox', options: { dropbox: { accessToken: 'dummy' } } },
      csvImports: [
        {
          id: 'test-1',
          name: 'Test Import',
          targets: [{ type: 'csvDashboards', source: 'gmail' }],
          schedule: '0 4 * * *',
          enabled: true,
          replaceExisting: false,
        },
      ],
    });

    const executionExecute = vi.fn().mockRejectedValue(new GmailReauthRequiredError('Gmailの再認可が必要です（invalid_grant）'));
    const mockGenerateFailureAlert = vi.fn().mockResolvedValue(undefined);

    const scheduler = new CsvImportScheduler({
      historyService: {
        createHistory: vi.fn().mockResolvedValue('history-1'),
        completeHistory: vi.fn(),
        failHistory: vi.fn(),
        cleanupOldHistory: vi.fn(),
      } as any,
      alertService: {
        generateFailureAlert: mockGenerateFailureAlert,
        generateConsecutiveFailureAlert: vi.fn(),
      } as any,
      createExecutionService: () => ({ execute: executionExecute } as any),
    });

    // 手動実行
    await expect(scheduler.runImport('test-1')).rejects.toThrow();

    // 通常の失敗アラートは生成される
    expect(mockGenerateFailureAlert).toHaveBeenCalledTimes(1);
    // Gmail認証切れアラートは生成されない（手動実行時）
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });
});

