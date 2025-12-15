import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { BackupService } from '../backup.service';
import { LocalStorageProvider } from '../storage/local-storage.provider';
import { FileBackupTarget } from '../targets/file-backup.target';

const tmpDir = () => path.join(os.tmpdir(), `backup-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);

describe('BackupService with LocalStorageProvider', () => {
  let workDir: string;
  let backupService: BackupService;

  beforeEach(async () => {
    workDir = tmpDir();
    process.env.BACKUP_STORAGE_DIR = workDir;
    backupService = new BackupService(new LocalStorageProvider());
    await fs.mkdir(workDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should backup and restore a single file', async () => {
    const sourceFile = path.join(workDir, 'source.txt');
    await fs.writeFile(sourceFile, 'hello-backup');

    const target = new FileBackupTarget(sourceFile);
    const result = await backupService.backup(target);

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();

    const restoredPath = path.join(workDir, 'restored.txt');
    const restore = await backupService.restore(result.path!, { destination: restoredPath });
    expect(restore.success).toBe(true);

    const restoredContent = await fs.readFile(restoredPath, 'utf-8');
    expect(restoredContent).toBe('hello-backup');
  });

  it('should list and delete backups', async () => {
    const sourceFile = path.join(workDir, 'source2.txt');
    await fs.writeFile(sourceFile, 'list-delete');

    const target = new FileBackupTarget(sourceFile);
    const result = await backupService.backup(target);
    expect(result.success).toBe(true);

    const list = await backupService.listBackups();
    expect(list.some(entry => entry.path === result.path)).toBe(true);

    await backupService.deleteBackup(result.path!);
    const listAfter = await backupService.listBackups();
    expect(listAfter.some(entry => entry.path === result.path)).toBe(false);
  });
});

