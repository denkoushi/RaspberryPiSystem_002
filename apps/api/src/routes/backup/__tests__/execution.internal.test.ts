import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  createTarget: vi.fn(),
  execute: vi.fn(),
  findTarget: vi.fn(),
  isFallbackConfig: vi.fn(),
  loadConfig: vi.fn(),
  resolveProviders: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('../../../services/backup/backup-config.loader.js', () => ({
  BackupConfigLoader: {
    isFallbackConfig: mocks.isFallbackConfig,
    load: mocks.loadConfig,
    save: mocks.saveConfig,
  },
}));

vi.mock('../../../services/backup/backup-execution.service.js', () => ({
  executeBackupAcrossProviders: mocks.execute,
  findBackupTargetConfig: mocks.findTarget,
  resolveBackupProviders: mocks.resolveProviders,
}));

vi.mock('../../../services/backup/backup-target-factory.js', () => ({
  BackupTargetFactory: { createFromConfig: mocks.createTarget },
}));

vi.mock('../../../services/backup/post-backup-cleanup.service.js', () => ({
  cleanupBackupsAfterManualExecution: mocks.cleanup,
}));

import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { registerBackupExecutionRoutes } from '../execution.js';

const enabledTarget = {
  kind: 'csv',
  source: 'employees',
  enabled: true,
};

function configWithTargets(targets: Array<typeof enabledTarget>) {
  return {
    storage: { provider: 'local', options: { basePath: '/tmp/not-used' } },
    targets,
  };
}

describe('POST /api/backup/internal', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.isFallbackConfig.mockReturnValue(false);
    mocks.loadConfig.mockResolvedValue(configWithTargets([enabledTarget]));
    mocks.createTarget.mockReturnValue({});
    mocks.resolveProviders.mockReturnValue(['local']);
    mocks.execute.mockResolvedValue({
      results: [{ provider: 'local', success: true, path: 'backup/path', sizeBytes: 1 }],
    });
    mocks.cleanup.mockResolvedValue(undefined);

    app = Fastify();
    registerErrorHandler(app);
    await app.register(async (instance) => {
      await registerBackupExecutionRoutes(instance);
    }, { prefix: '/api' });
  });

  afterEach(async () => {
    await app.close();
  });

  const request = (remoteAddress: string, payload: unknown = {
    kind: 'csv',
    source: 'employees',
  }) => app.inject({
    method: 'POST',
    url: '/api/backup/internal',
    remoteAddress,
    payload,
  });

  it.each(['172.18.0.2', '10.20.30.40', '::ffff:172.18.0.2'])(
    'rejects non-loopback socket peer %s before loading configuration',
    async (remoteAddress) => {
      const response = await request(remoteAddress);

      expect(response.statusCode).toBe(403);
      expect(mocks.loadConfig).not.toHaveBeenCalled();
      expect(mocks.createTarget).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    }
  );

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'accepts loopback socket peer %s',
    async (remoteAddress) => {
      const response = await request(remoteAddress);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ success: true, path: 'backup/path' });
      expect(mocks.createTarget).toHaveBeenCalledOnce();
      expect(mocks.execute).toHaveBeenCalledOnce();
    }
  );

  it('rejects an empty body before configuration or backup work', async () => {
    const response = await request('127.0.0.1', {});

    expect(response.statusCode).toBe(400);
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.createTarget).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown source', configWithTargets([enabledTarget]), { kind: 'csv', source: 'missing' }],
    ['unknown kind', configWithTargets([enabledTarget]), { kind: 'file', source: 'employees' }],
    ['disabled', configWithTargets([{ ...enabledTarget, enabled: false }]), { kind: 'csv', source: 'employees' }],
  ])('rejects a %s target with the same response before factory or provider work', async (_case, config, payload) => {
    mocks.loadConfig.mockResolvedValue(config);
    const response = await request('127.0.0.1', payload);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ message: 'Internal backup target is not enabled' });
    expect(mocks.createTarget).not.toHaveBeenCalled();
    expect(mocks.resolveProviders).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it.each(['missing', 'unreadable', 'malformed JSON', 'schema-invalid'])(
    'rejects a %s backup.json fallback before factory or provider work',
    async () => {
      mocks.isFallbackConfig.mockReturnValue(true);

      const response = await request('127.0.0.1');

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ message: 'Internal backup target is not enabled' });
      expect(mocks.createTarget).not.toHaveBeenCalled();
      expect(mocks.resolveProviders).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.cleanup).not.toHaveBeenCalled();
    }
  );
});
