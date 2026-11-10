import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    workDir = tmpDir();
    vi.stubEnv('BACKUP_STORAGE_DIR', workDir);
    backupService = new BackupService(new LocalStorageProvider());
    await fs.mkdir(workDir, { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
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

  it('fails before producing backup data when the encryption key is missing', async () => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', '');
    const createBackup = vi.fn(async () => Buffer.from('data'));
    const result = await backupService.backup({ info: { type: 'file', source: 'x' }, createBackup } as never);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BACKUP_ENCRYPTION_KEY/);
    expect(createBackup).not.toHaveBeenCalled();
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

  it('should sanitize label so backup path is safe', async () => {
    const sourceFile = path.join(workDir, 'source3.txt');
    await fs.writeFile(sourceFile, 'label-sanitize');

    const target = new FileBackupTarget(sourceFile);
    const result = await backupService.backup(target, { label: 'manual-test /app/config/host-etc  ' });
    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();

    // label内のスラッシュや末尾空白がパスを壊さないこと（/ を含まない）
    expect(result.path!).not.toContain('/app/config/');
    // 正規化されたラベルが path の中間要素に入ること
    expect(result.path!).toContain('-manual-test_app_config_host-etc/');
  });
});

