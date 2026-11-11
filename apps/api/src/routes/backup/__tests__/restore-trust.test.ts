import Fastify, { type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), download: vi.fn(), restore: vi.fn(), createProvider: vi.fn(), createTarget: vi.fn(),
  createHistory: vi.fn(), completeHistory: vi.fn(), failHistory: vi.fn(), preBackup: vi.fn()
}));
vi.mock('dotenv', () => ({ config: vi.fn() }));

vi.mock('../../../lib/auth.js', () => ({ authorizeRoles: () => async () => {} }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { backupHistory: { findFirst: mocks.findFirst } } }));
vi.mock('../../../services/backup/backup-config.loader.js', () => ({
  BackupConfigLoader: {
    load: async () => ({ storage: { provider: 'dropbox', options: { accessToken: 'test' } }, targets: [] })
  }
}));
vi.mock('../../../services/backup/storage-provider-factory.js', () => ({
  StorageProviderFactory: { create: mocks.createProvider, createFromConfig: mocks.createProvider }
}));
vi.mock('../../../services/backup/backup-target-factory.js', () => ({
  BackupTargetFactory: { createFromConfig: mocks.createTarget }
}));
vi.mock('../../../services/backup/backup-history.service.js', () => ({
  BackupHistoryService: class {
    createHistory = mocks.createHistory;
    completeHistory = mocks.completeHistory;
    failHistory = mocks.failHistory;
    getHistoryById = async () => ({});
  }
}));
vi.mock('../../../services/backup/pre-restore-backup.service.js', () => ({ runPreRestoreBackup: mocks.preBackup }));

import { registerBackupRestoreRoutes } from '../restore.js';
import { registerBackupRestoreDropboxRoutes } from '../restore-dropbox.js';
import { EncryptedStorageProvider } from '../../../services/backup/storage/encrypted-storage.provider.js';
import { encryptBackup } from '../../../services/backup/storage/backup-encryption.js';
import { ApiError } from '../../../lib/errors.js';

const key = Buffer.alloc(32, 7);
const data = Buffer.from('trusted database dump');
const hash = createHash('sha256').update(data).digest('hex');

describe.each(['/backup/restore', '/backup/restore/from-dropbox'])('%s restore validation', (url) => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', key.toString('base64'));
    mocks.createHistory.mockResolvedValue('history');
    mocks.restore.mockResolvedValue({ success: true, timestamp: new Date() });
    mocks.createTarget.mockReturnValue({ restore: mocks.restore });
    mocks.createProvider.mockReturnValue(new EncryptedStorageProvider({
      download: mocks.download, upload: vi.fn(), delete: vi.fn(), list: vi.fn()
    }));
    app = Fastify();
    app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
      const status = error instanceof ApiError ? error.statusCode : 500;
      reply.status(status).send({ message: error.message });
    });
    await registerBackupRestoreRoutes(app);
    await registerBackupRestoreDropboxRoutes(app);
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const restore = (extra = {}) => app.inject({
    method: 'POST', url,
    payload: {
      backupPath: 'database/snapshot/db.sql.gz', preBackup: false,
      storage: { provider: 'dropbox', options: { accessToken: 'test' } }, ...extra
    }
  });

  it('passes authenticated plaintext to the database target, ignoring a caller hash', async () => {
    mocks.download.mockResolvedValue(encryptBackup(key, data));
    const response = await restore({ expectedHash: 'wrong' });
    expect(response.statusCode).toBe(200);
    expect(mocks.restore).toHaveBeenCalledWith(data, expect.any(Object));
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.failHistory).not.toHaveBeenCalled();
  });

  it.each(['missing', 'tampered'])('rejects %s encryption before database restore and records FAILED', async (scenario) => {
    const encrypted = encryptBackup(key, data);
    if (scenario === 'missing') vi.stubEnv('BACKUP_ENCRYPTION_KEY', '');
    else encrypted[21] ^= 0xff;
    mocks.download.mockResolvedValue(encrypted);
    const response = await restore();
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe('このバックアップは復元できません');
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.failHistory).toHaveBeenCalledWith('history', 'このバックアップは復元できません');
  });

  it('records a failed database restore with the SQL error instead of completing history', async () => {
    mocks.download.mockResolvedValue(encryptBackup(key, data));
    const message = 'Database restore failed: ERROR: cannot drop table because other objects depend on it';
    mocks.restore.mockRejectedValue(new ApiError(500, message));
    const response = await restore();
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe(message);
    expect(mocks.failHistory).toHaveBeenCalledWith('history', message);
    expect(mocks.completeHistory).not.toHaveBeenCalled();
  });

  it('accepts legacy plaintext based on the current database before restore begins', async () => {
    mocks.download.mockResolvedValue(data);
    mocks.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'match' });
    mocks.restore.mockImplementation(async () => {
      expect(mocks.findFirst).toHaveBeenCalledTimes(2);
      return { success: true, timestamp: new Date() };
    });
    const response = await restore({ expectedHash: 'wrong' });
    expect(response.statusCode).toBe(200);
    expect(mocks.restore).toHaveBeenCalledWith(data, expect.any(Object));
  });

  if (url.endsWith('from-dropbox')) {
    it('saves a generic restore exclusively inside a private temporary directory', async () => {
      mocks.createTarget.mockReturnValue({});
      mocks.download.mockResolvedValue(encryptBackup(key, data));
      const mkdtemp = vi.spyOn(fs, 'mkdtemp');
      const writeFile = vi.spyOn(fs, 'writeFile');
      try {
        const response = await restore({ targetKind: 'image' });
        expect(response.statusCode).toBe(200);
        const directory = await mkdtemp.mock.results[0].value;
        const tempPath = path.join(directory, 'restored.backup');
        expect(mkdtemp).toHaveBeenCalledWith(path.join(os.tmpdir(), 'restored-'));
        expect(writeFile).toHaveBeenCalledWith(tempPath, data, { flag: 'wx', mode: 0o600 });
        expect(await fs.readFile(tempPath)).toEqual(data);
        expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
        expect((await fs.stat(tempPath)).mode & 0o777).toBe(0o600);
        expect(mocks.completeHistory).toHaveBeenCalledWith('history', expect.objectContaining({
          targetKind: 'image', sizeBytes: data.length, path: 'database/snapshot/db.sql.gz'
        }));
        expect(response.json()).toEqual({
          success: true, message: 'Backup restored successfully',
          backupPath: 'database/snapshot/db.sql.gz', originalPath: 'database/snapshot/db.sql.gz',
          timestamp: expect.any(String), historyId: 'history'
        });
        expect(mocks.restore).not.toHaveBeenCalled();
        expect(mocks.failHistory).not.toHaveBeenCalled();
      } finally {
        const directory = await mkdtemp.mock.results[0]?.value;
        vi.restoreAllMocks();
        if (directory) await fs.rm(directory, { recursive: true, force: true });
      }
    });

    it('ignores a caller-supplied size', async () => {
      mocks.download.mockResolvedValue(encryptBackup(key, data));
      const response = await restore({ expectedSize: 999 });
      expect(response.statusCode).toBe(200);
      expect(mocks.restore).toHaveBeenCalledWith(data, expect.any(Object));
    });
  }

  it('takes the pre-restore backup only after the backup is accepted', async () => {
    mocks.download.mockResolvedValue(encryptBackup(key, data));
    mocks.preBackup.mockImplementation(async () => {
      expect(mocks.download).toHaveBeenCalled();
      expect(mocks.restore).not.toHaveBeenCalled();
    });
    const response = await restore({ preBackup: true });
    expect(response.statusCode).toBe(200);
    expect(mocks.preBackup).toHaveBeenCalledTimes(1);
    expect(mocks.restore).toHaveBeenCalledWith(data, expect.any(Object));
  });

  it('does not take a pre-restore backup when the backup is rejected', async () => {
    mocks.download.mockResolvedValue(data);
    mocks.findFirst.mockResolvedValue(null);
    const response = await restore({ preBackup: true });
    expect(response.statusCode).toBe(400);
    expect(mocks.preBackup).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it.each(['unrecorded', 'encrypted-history'])('rejects %s plaintext even with a matching caller hash', async (scenario) => {
    mocks.download.mockResolvedValue(data);
    mocks.findFirst.mockResolvedValue(scenario === 'unrecorded' ? null : { id: 'encrypted' });
    const response = await restore({ expectedHash: hash, verifyIntegrity: false });
    expect(response.statusCode).toBe(400);
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.failHistory).toHaveBeenCalled();
  });
});
