import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupService } from '../backup.service.js';
import { LocalStorageProvider } from '../storage/local-storage.provider.js';
import type { LargeFileUploadProvider, StorageProvider } from '../storage/storage-provider.interface.js';
import { DirectoryBackupTarget } from '../targets/directory-backup.target.js';

const execFileAsync = promisify(execFile);

describe('DirectoryBackupTarget', () => {
  let workDir: string;
  let dir: string;
  let tempDir: string;
  let baseDir: string;
  let service: BackupService;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'directory-backup-'));
    dir = path.join(workDir, 'source');
    tempDir = path.join(workDir, 'temp');
    baseDir = path.join(workDir, 'stored');
    await fs.mkdir(dir);
    await fs.mkdir(tempDir);
    vi.stubEnv('BACKUP_TEMP_DIR', tempDir);
    service = new BackupService(new LocalStorageProvider({ baseDir }));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('backs up an incompressible folder larger than 200 MB', async () => {
    for (let i = 0; i < 3; i++) {
      await fs.writeFile(path.join(dir, `random-${i}.bin`), randomBytes(70 * 1024 * 1024));
    }

    const result = await service.backup(new DirectoryBackupTarget(dir));

    expect(result.success).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(200 * 1024 * 1024);
    expect(result.path).toBeDefined();
    const stored = await fs.stat(path.join(baseDir, result.path!));
    expect(stored.isFile()).toBe(true);
    expect(stored.size).toBe(result.sizeBytes);
    expect(await fs.readdir(tempDir)).toEqual([]);
  }, 120_000);

  it('round-trips a nested file through the stored tar.gz archive', async () => {
    await fs.mkdir(path.join(dir, 'nested'));
    const content = 'nested backup contents\n';
    await fs.writeFile(path.join(dir, 'nested', 'file.txt'), content);

    const result = await service.backup(new DirectoryBackupTarget(dir));

    expect(result.success).toBe(true);
    const extracted = path.join(workDir, 'extracted');
    await fs.mkdir(extracted);
    await execFileAsync('tar', ['-xzf', path.join(baseDir, result.path!), '-C', extracted]);
    expect(await fs.readFile(path.join(extracted, 'nested', 'file.txt'), 'utf-8')).toBe(content);
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('returns an upload failure and removes the temporary archive', async () => {
    await fs.writeFile(path.join(dir, 'file.txt'), 'upload failure');
    const storage: StorageProvider & LargeFileUploadProvider = {
      upload: vi.fn(),
      download: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      uploadFromFile: vi.fn().mockRejectedValue(new Error('upload failed'))
    };

    const result = await new BackupService(storage).backup(new DirectoryBackupTarget(dir));

    expect(result).toMatchObject({ success: false, error: 'upload failed' });
    expect(storage.uploadFromFile).toHaveBeenCalledOnce();
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('returns a tar failure and removes the temporary archive', async () => {
    const result = await service.backup(new DirectoryBackupTarget(path.join(workDir, 'missing')));

    expect(result.success).toBe(false);
    expect(result.error).toEqual(expect.any(String));
    expect(result.error!.length).toBeGreaterThan(0);
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('keeps createBackup returning a gzip Buffer and removes the temporary archive', async () => {
    await fs.writeFile(path.join(dir, 'file.txt'), 'buffer backup');

    const data = await new DirectoryBackupTarget(dir).createBackup();

    expect(Buffer.isBuffer(data)).toBe(true);
    expect(data[0]).toBe(0x1f);
    expect(data[1]).toBe(0x8b);
    expect(await fs.readdir(tempDir)).toEqual([]);
  });
});
