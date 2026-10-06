import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_ENCRYPTION_MAGIC,
  BACKUP_ENCRYPTION_OVERHEAD_BYTES,
  BackupEncryptionError,
  decryptBackupIfEncrypted,
  encryptBackup,
  encryptBackupFile,
  isEncryptedBackup,
  loadBackupEncryptionKey
} from '../storage/backup-encryption.js';
import { EncryptedStorageProvider } from '../storage/encrypted-storage.provider.js';
import type { LargeFileUploadProvider, StorageProvider } from '../storage/storage-provider.interface.js';
import { StorageProviderFactory } from '../storage-provider-factory.js';
import { DropboxStorageProvider } from '../storage/dropbox-storage.provider.js';

const key = randomBytes(32);

describe('backup encryption', () => {
  it('round-trips a buffer and adds a fixed overhead', () => {
    const plain = Buffer.from('borrow_return dump');
    const encrypted = encryptBackup(key, plain);

    expect(encrypted.subarray(0, BACKUP_ENCRYPTION_MAGIC.length)).toEqual(BACKUP_ENCRYPTION_MAGIC);
    expect(encrypted.includes(plain)).toBe(false);
    expect(encrypted.length).toBe(plain.length + BACKUP_ENCRYPTION_OVERHEAD_BYTES);
    expect(decryptBackupIfEncrypted(key, encrypted)).toEqual(plain);
  });

  it('returns backups made before encryption unchanged', () => {
    const legacy = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02]);
    expect(isEncryptedBackup(legacy)).toBe(false);
    expect(decryptBackupIfEncrypted(key, legacy)).toEqual(legacy);
    expect(decryptBackupIfEncrypted(undefined, legacy)).toEqual(legacy);
  });

  it('rejects a wrong key, tampered data, and a missing key', () => {
    const encrypted = encryptBackup(key, Buffer.from('secret rows'));
    expect(() => decryptBackupIfEncrypted(randomBytes(32), encrypted)).toThrow(BackupEncryptionError);

    const tampered = Buffer.from(encrypted);
    tampered[BACKUP_ENCRYPTION_MAGIC.length + 12] ^= 0xff;
    expect(() => decryptBackupIfEncrypted(key, tampered)).toThrow(BackupEncryptionError);

    expect(() => decryptBackupIfEncrypted(undefined, encrypted)).toThrow(/BACKUP_ENCRYPTION_KEY/);
  });

  it('loads a 32-byte base64 key and rejects other lengths', () => {
    expect(loadBackupEncryptionKey({})).toBeUndefined();
    expect(loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: ' ' })).toBeUndefined();
    expect(loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: key.toString('base64') })).toEqual(key);
    expect(() => loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: randomBytes(16).toString('base64') })).toThrow(
      BackupEncryptionError
    );
  });

  describe('files', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-encryption-'));
    });
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('streams a large file into the same format as the buffer path', async () => {
      const plain = randomBytes(3 * 1024 * 1024 + 7);
      const source = path.join(dir, 'dump.sql.gz');
      const destination = path.join(dir, 'dump.enc');
      await fs.writeFile(source, plain);

      await encryptBackupFile(key, source, destination);
      const encrypted = await fs.readFile(destination);

      expect(encrypted.length).toBe(plain.length + BACKUP_ENCRYPTION_OVERHEAD_BYTES);
      expect(decryptBackupIfEncrypted(key, encrypted)).toEqual(plain);
    });

    it('encrypts before handing a file to the inner provider and removes the temporary copy', async () => {
      const plain = Buffer.from('large dump body');
      const source = path.join(dir, 'dump.sql.gz');
      await fs.writeFile(source, plain);
      const uploaded: { path: string; body: Buffer; tempPath: string }[] = [];
      const inner: StorageProvider & LargeFileUploadProvider = {
        upload: vi.fn(),
        download: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        uploadFromFile: vi.fn(async (tempPath: string, remotePath: string) => {
          uploaded.push({ path: remotePath, body: await fs.readFile(tempPath), tempPath });
        })
      };

      const tempDir = path.join(dir, 'missing-temp');
      await new EncryptedStorageProvider(inner, key, tempDir).uploadFromFile(source, 'database/x/borrow_return.sql.gz');

      expect(await fs.readdir(tempDir)).toEqual([]);

      expect(uploaded).toHaveLength(1);
      expect(uploaded[0].path).toBe('database/x/borrow_return.sql.gz');
      expect(decryptBackupIfEncrypted(key, uploaded[0].body)).toEqual(plain);
      await expect(fs.access(uploaded[0].tempPath)).rejects.toThrow();
      expect(await fs.readFile(source)).toEqual(plain);
    });
  });

  it('encrypts buffer uploads and decrypts downloads through the inner provider', async () => {
    const stored = new Map<string, Buffer>();
    const inner: StorageProvider = {
      upload: vi.fn(async (file: Buffer, remotePath: string) => {
        stored.set(remotePath, file);
      }),
      download: vi.fn(async (remotePath: string) => stored.get(remotePath) as Buffer),
      delete: vi.fn(),
      list: vi.fn()
    };
    const provider = new EncryptedStorageProvider(inner, key);

    await provider.upload(Buffer.from('employees.csv'), 'csv/x/employees.csv');
    stored.set('csv/legacy/items.csv', Buffer.from('legacy plain'));

    expect(isEncryptedBackup(stored.get('csv/x/employees.csv') as Buffer)).toBe(true);
    expect(await provider.download('csv/x/employees.csv')).toEqual(Buffer.from('employees.csv'));
    expect(await provider.download('csv/legacy/items.csv')).toEqual(Buffer.from('legacy plain'));
  });
});

describe('StorageProviderFactory with BACKUP_ENCRYPTION_KEY', () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.BACKUP_ENCRYPTION_KEY;
    } else {
      process.env.BACKUP_ENCRYPTION_KEY = original;
    }
  });

  it('wraps Dropbox when a key is configured and keeps the plain provider otherwise', () => {
    const options = { provider: 'dropbox' as const, accessToken: 'test-access-token', basePath: '/test-backups' };

    delete process.env.BACKUP_ENCRYPTION_KEY;
    expect(StorageProviderFactory.create(options)).toBeInstanceOf(DropboxStorageProvider);

    process.env.BACKUP_ENCRYPTION_KEY = key.toString('base64');
    expect(StorageProviderFactory.create(options)).toBeInstanceOf(EncryptedStorageProvider);
  });

  it('never wraps local storage', () => {
    process.env.BACKUP_ENCRYPTION_KEY = key.toString('base64');
    expect(StorageProviderFactory.create({ provider: 'local', basePath: '/tmp/backups' })).not.toBeInstanceOf(
      EncryptedStorageProvider
    );
  });
});
