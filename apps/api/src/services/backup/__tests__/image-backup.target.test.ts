import { describe, expect, it, beforeEach } from 'vitest';
import { ImageBackupTarget } from '../targets/image-backup.target';
import { BackupService } from '../backup.service';
import { MockStorageProvider } from '../storage/mock-storage.provider';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('ImageBackupTarget', () => {
  let storageProvider: MockStorageProvider;
  let backupService: BackupService;
  let testStorageDir: string;

  beforeEach(async () => {
    storageProvider = new MockStorageProvider();
    backupService = new BackupService(storageProvider);
    
    // テスト用のストレージディレクトリを作成
    testStorageDir = path.join(os.tmpdir(), `test-photo-storage-${Date.now()}`);
    process.env.PHOTO_STORAGE_DIR = testStorageDir;
    
    const photosDir = path.join(testStorageDir, 'photos');
    const thumbnailsDir = path.join(testStorageDir, 'thumbnails');
    await fs.mkdir(photosDir, { recursive: true });
    await fs.mkdir(thumbnailsDir, { recursive: true });
    
    // テスト用の画像ファイルを作成
    await fs.writeFile(path.join(photosDir, 'test.jpg'), Buffer.from('fake-image-data'));
    await fs.writeFile(path.join(thumbnailsDir, 'test_thumb.jpg'), Buffer.from('fake-thumbnail-data'));
  });

  it('should backup images directory', async () => {
    const target = new ImageBackupTarget({ label: 'test-images' });
    const result = await backupService.backup(target, { label: 'test-images' });

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.sizeBytes).toBeGreaterThan(0);

    // バックアップされたtar.gzを取得して検証
    const backupData = await storageProvider.download(result.path!);
    
    // tar.gzファイルのマジックナンバーを確認（gzip: 1f 8b）
    expect(backupData[0]).toBe(0x1f);
    expect(backupData[1]).toBe(0x8b);
  });

  it('should handle empty directories', async () => {
    // 空のディレクトリでテスト
    const emptyDir = path.join(os.tmpdir(), `test-empty-storage-${Date.now()}`);
    const originalEnv = process.env.PHOTO_STORAGE_DIR;
    process.env.PHOTO_STORAGE_DIR = emptyDir;
    
    try {
      const photosDir = path.join(emptyDir, 'photos');
      const thumbnailsDir = path.join(emptyDir, 'thumbnails');
      await fs.mkdir(photosDir, { recursive: true });
      await fs.mkdir(thumbnailsDir, { recursive: true });

      const target = new ImageBackupTarget({ label: 'test-empty-images' });
      const result = await backupService.backup(target, { label: 'test-empty-images' });

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
    } finally {
      // 環境変数を元に戻す
      if (originalEnv) {
        process.env.PHOTO_STORAGE_DIR = originalEnv;
      } else {
        delete process.env.PHOTO_STORAGE_DIR;
      }
    }
  });
});
