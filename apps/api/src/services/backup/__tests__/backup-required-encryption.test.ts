import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageProviderFactory } from '../storage-provider-factory.js';
import { LocalStorageProvider } from '../storage/local-storage.provider.js';
import { DropboxStorageProvider } from '../storage/dropbox-storage.provider.js';
import { EncryptedStorageProvider } from '../storage/encrypted-storage.provider.js';
import { decryptBackupIfEncrypted, isEncryptedBackup } from '../storage/backup-encryption.js';
import { BackupService } from '../backup.service.js';
import { BackupConfigSchema } from '../backup-config.js';

const history = vi.hoisted(() => ({ createHistory: vi.fn(), failHistory: vi.fn(), completeHistory: vi.fn() }));
vi.mock('../backup-history.service.js', () => ({ BackupHistoryService: class {
  createHistory = history.createHistory;
  failHistory = history.failHistory;
  completeHistory = history.completeHistory;
} }));
import { executeBackupAcrossProviders } from '../backup-execution.service.js';

const key = Buffer.alloc(32, 7);
const plain = Buffer.from('backup contents');

describe('required backup encryption', () => {
  let dir: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'required-encryption-'));
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', key.toString('base64'));
    vi.stubEnv('BACKUP_STORAGE_DIR', path.join(dir, 'backups'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('records the plaintext hash and encryption marker after a successful upload', async () => {
    history.createHistory.mockResolvedValue('success');
    const { results } = await executeBackupAcrossProviders({
      config: BackupConfigSchema.parse({ storage: { provider: 'local' }, targets: [] }),
      target: { info: { type: 'csv', source: 'employees' }, createBackup: async () => plain },
      targetKind: 'csv', targetSource: 'employees', protocol: 'http', host: 'localhost'
    });
    expect(results[0].success).toBe(true);
    expect(history.completeHistory).toHaveBeenCalledWith('success', expect.objectContaining({
      hash: createHash('sha256').update(plain).digest('hex'), encrypted: true
    }));
    expect(history.failHistory).not.toHaveBeenCalled();
  });

  it('records a missing-key write as FAILED through the normal execution flow', async () => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', '');
    history.createHistory.mockResolvedValue('missing-key');
    const { results } = await executeBackupAcrossProviders({
      config: BackupConfigSchema.parse({ storage: { provider: 'local' }, targets: [] }),
      target: { info: { type: 'csv', source: 'employees' }, createBackup: async () => plain },
      targetKind: 'csv', targetSource: 'employees', protocol: 'http', host: 'localhost'
    });
    expect(results).toEqual([{ provider: 'local', success: false, error: expect.stringContaining('BACKUP_ENCRYPTION_KEY') }]);
    expect(history.failHistory).toHaveBeenCalledWith('missing-key', expect.stringContaining('BACKUP_ENCRYPTION_KEY'));
    expect(history.completeHistory).not.toHaveBeenCalled();
  });

  it.each(['buffer', 'file'] as const)('encrypts local %s uploads with private permissions, including overwrites', async (kind) => {
    const provider = new LocalStorageProvider();
    const source = path.join(dir, 'source');
    const destination = path.join(dir, 'backups', 'nested', 'dump');
    await fs.writeFile(source, plain);
    const upload = () => kind === 'buffer' ? provider.upload(plain, 'nested/dump') : provider.uploadFromFile(source, 'nested/dump');
    await upload();
    expect((await fs.stat(path.join(dir, 'backups'))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.dirname(destination))).mode & 0o777).toBe(0o700);
    await fs.chmod(destination, 0o644);
    await upload();
    const stored = await provider.download('nested/dump');
    expect(isEncryptedBackup(stored)).toBe(true);
    expect(decryptBackupIfEncrypted(key, stored)).toEqual(plain);
    expect((await fs.stat(destination)).mode & 0o777).toBe(0o600);
  });

  it.each(['buffer', 'file'] as const)('encrypts Dropbox %s uploads', async (kind) => {
    const upload = vi.spyOn(DropboxStorageProvider.prototype, 'upload').mockResolvedValue(undefined);
    const uploadFile = vi.spyOn(DropboxStorageProvider.prototype, 'uploadFromFile').mockImplementation(async (source) => {
      expect(decryptBackupIfEncrypted(key, await fs.readFile(source))).toEqual(plain);
    });
    const provider = StorageProviderFactory.create({ provider: 'dropbox', accessToken: 'test' }) as EncryptedStorageProvider;
    if (kind === 'buffer') {
      await provider.upload(plain, 'dump');
      expect(decryptBackupIfEncrypted(key, upload.mock.calls[0][0])).toEqual(plain);
    } else {
      const source = path.join(dir, 'source');
      await fs.writeFile(source, plain);
      await provider.uploadFromFile(source, 'dump');
      expect(uploadFile).toHaveBeenCalledOnce();
    }
  });

  it.each(['local', 'dropbox'] as const)('allows %s construction and raw reads/list/delete without a key, but rejects both writes', async (name) => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', '');
    vi.spyOn(DropboxStorageProvider.prototype, 'download').mockResolvedValue(plain);
    vi.spyOn(DropboxStorageProvider.prototype, 'list').mockResolvedValue([]);
    vi.spyOn(DropboxStorageProvider.prototype, 'delete').mockResolvedValue(undefined);
    const upload = vi.spyOn(DropboxStorageProvider.prototype, 'upload');
    const uploadFile = vi.spyOn(DropboxStorageProvider.prototype, 'uploadFromFile');
    const provider = StorageProviderFactory.create({ provider: name, accessToken: 'test' });
    if (name === 'local') {
      await fs.mkdir(path.join(dir, 'backups'));
      await fs.writeFile(path.join(dir, 'backups', 'legacy'), plain);
    }
    await expect(provider.download('legacy')).resolves.toEqual(plain);
    await expect(provider.list('')).resolves.toBeInstanceOf(Array);
    await expect(provider.upload(plain, 'dump')).rejects.toThrow(/BACKUP_ENCRYPTION_KEY/);
    await expect((provider as LocalStorageProvider).uploadFromFile('/nonexistent', 'dump')).rejects.toThrow(/BACKUP_ENCRYPTION_KEY/);
    expect(upload).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    await expect(provider.delete('legacy')).resolves.toBeUndefined();
  });

  it.each(['buffer', 'file'] as const)('hashes the actual %s upload source before encryption and cleanup', async (kind) => {
    const source = path.join(dir, 'source');
    const data = Buffer.alloc(2 * 1024 * 1024 + 1, 42);
    await fs.writeFile(source, data);
    const cleanup = vi.fn(() => fs.unlink(source));
    const createBackup = vi.fn().mockRejectedValue(new Error('must use upload source'));
    const result = await new BackupService(new LocalStorageProvider()).backup({
      info: { type: 'database', source: 'db' },
      createBackup,
      createUploadSource: async () => kind === 'buffer'
        ? { kind: 'buffer', data }
        : { kind: 'file', filePath: source, cleanup }
    });
    expect(result.success).toBe(true);
    expect(result.hash).toBe(createHash('sha256').update(data).digest('hex'));
    expect(decryptBackupIfEncrypted(key, await new LocalStorageProvider().download(result.path!))).toEqual(data);
    expect(createBackup).not.toHaveBeenCalled();
    if (kind === 'file') expect(cleanup).toHaveBeenCalledOnce();
  });
});
