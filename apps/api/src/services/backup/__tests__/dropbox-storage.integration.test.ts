import { describe, expect, it } from 'vitest';
import { DropboxStorageProvider } from '../storage/dropbox-storage.provider';
import { BackupService } from '../backup.service';
import { FileBackupTarget } from '../targets/file-backup.target';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Dropbox統合テスト（実際のDropbox APIを使用）
 * 
 * 注意: このテストは実際のDropboxアカウントへのアクセスが必要です。
 * 環境変数 DROPBOX_ACCESS_TOKEN が設定されている場合のみ実行されます。
 * CI環境では実行されません（モックテストを使用）。
 */
describe('DropboxStorageProvider integration (requires DROPBOX_ACCESS_TOKEN)', () => {
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;
  const skipIfNoToken = !accessToken ? it.skip : it;

  skipIfNoToken('should upload and download file to Dropbox', async () => {
    const provider = new DropboxStorageProvider({
      accessToken: accessToken!,
      basePath: '/test-backups'
    });

    const testData = Buffer.from('test-dropbox-upload');
    const testPath = `test-${Date.now()}.txt`;

    try {
      // アップロード
      await provider.upload(testData, testPath);
      
      // ダウンロード
      const downloaded = await provider.download(testPath);
      expect(downloaded.toString()).toBe('test-dropbox-upload');

      // クリーンアップ
      await provider.delete(testPath);
    } catch (error) {
      // クリーンアップ（エラー時も）
      try {
        await provider.delete(testPath);
      } catch {
        // 無視
      }
      throw error;
    }
  }, 30000);

  skipIfNoToken('should list files in Dropbox', async () => {
    const provider = new DropboxStorageProvider({
      accessToken: accessToken!,
      basePath: '/test-backups'
    });

    const testData = Buffer.from('test-list');
    const testPath = `list-test-${Date.now()}.txt`;

    try {
      await provider.upload(testData, testPath);
      
      const files = await provider.list('/test-backups');
      // パスは完全パス（/test-backups/list-test-xxx.txt）の形式で返される
      const found = files.some(f => {
        const pathLower = f.path.toLowerCase();
        const testPathLower = testPath.toLowerCase();
        return pathLower.includes(testPathLower) || pathLower.endsWith('/' + testPathLower);
      });
      expect(found).toBe(true);

      await provider.delete(testPath);
    } catch (error) {
      try {
        await provider.delete(testPath);
      } catch {
        // 無視
      }
      throw error;
    }
  }, 30000);

  skipIfNoToken('should backup and restore via BackupService', async () => {
    const provider = new DropboxStorageProvider({
      accessToken: accessToken!,
      basePath: '/test-backups'
    });

    const backupService = new BackupService(provider);
    const tmpFile = path.join(os.tmpdir(), `dropbox-test-${Date.now()}.txt`);
    
    try {
      await fs.writeFile(tmpFile, 'dropbox-backup-test');
      const target = new FileBackupTarget(tmpFile);
      
      const result = await backupService.backup(target, { label: 'dropbox-test' });
      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();

      const restorePath = path.join(os.tmpdir(), `dropbox-restored-${Date.now()}.txt`);
      const restore = await backupService.restore(result.path!, { destination: restorePath });
      expect(restore.success).toBe(true);

      const content = await fs.readFile(restorePath, 'utf-8');
      expect(content).toBe('dropbox-backup-test');

      // クリーンアップ
      await backupService.deleteBackup(result.path!);
      await fs.rm(tmpFile, { force: true });
      await fs.rm(restorePath, { force: true });
    } catch (error) {
      // クリーンアップ
      await fs.rm(tmpFile, { force: true }).catch(() => {});
      throw error;
    }
  }, 60000);
});
