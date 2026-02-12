import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo, RestoreOptions, RestoreResult } from '../backup-types.js';
import { logger } from '../../../lib/logger.js';
import { getString } from '../../../lib/type-guards.js';

const execFileAsync = promisify(execFile);

/**
 * 画像バックアップターゲット
 * 
 * PhotoStorageの写真ディレクトリ全体をtarアーカイブとしてバックアップします。
 */
export class ImageBackupTarget implements BackupTarget {
  info: BackupTargetInfo;
  private readonly photosDir: string;
  private readonly thumbnailsDir: string;

  constructor(metadata?: Record<string, unknown>) {
    // 環境変数から取得、なければデフォルト値を使用
    const baseDir = process.env.PHOTO_STORAGE_DIR ||
      (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');
    this.photosDir = path.join(baseDir, 'photos');
    this.thumbnailsDir = path.join(baseDir, 'thumbnails');
    
    const metadataLabel = metadata ? getString(metadata, 'label') : undefined;
    this.info = {
      type: 'image',
      source: 'photo-storage',
      metadata: {
        ...metadata,
        label: metadataLabel || `images-${new Date().toISOString()}`,
        photosDir: this.photosDir,
        thumbnailsDir: this.thumbnailsDir
      }
    };
  }

  async createBackup(): Promise<Buffer> {
    // 一時ディレクトリを作成
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-backup-'));
    
    try {
      // 写真ディレクトリとサムネイルディレクトリを一時ディレクトリにコピー
      const backupPhotosDir = path.join(tmpDir, 'photos');
      const backupThumbnailsDir = path.join(tmpDir, 'thumbnails');
      
      // ディレクトリが存在する場合のみコピー
      try {
        await fs.access(this.photosDir);
        await fs.cp(this.photosDir, backupPhotosDir, { recursive: true });
      } catch {
        // ディレクトリが存在しない場合は空ディレクトリを作成
        await fs.mkdir(backupPhotosDir, { recursive: true });
      }
      
      try {
        await fs.access(this.thumbnailsDir);
        await fs.cp(this.thumbnailsDir, backupThumbnailsDir, { recursive: true });
      } catch {
        // ディレクトリが存在しない場合は空ディレクトリを作成
        await fs.mkdir(backupThumbnailsDir, { recursive: true });
      }

      // tarアーカイブを作成
      const archivePath = path.join(tmpDir, 'images.tar.gz');
      await execFileAsync('tar', ['-czf', archivePath, '-C', tmpDir, 'photos', 'thumbnails']);

      // アーカイブを読み込んでBufferとして返す
      const archiveBuffer = await fs.readFile(archivePath);

      // 一時ファイルを削除
      await fs.rm(tmpDir, { recursive: true, force: true });

      return archiveBuffer;
    } catch (error) {
      // エラー時も一時ファイルを削除
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async restore(backupData: Buffer, options?: RestoreOptions): Promise<RestoreResult> {
    void options;
    // 一時ディレクトリを作成してtar.gzを展開
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-restore-'));
    const archivePath = path.join(tmpDir, 'images.tar.gz');

    try {
      // tar.gzファイルを一時ディレクトリに保存
      await fs.writeFile(archivePath, backupData);

      logger?.info({ tmpDir, photosDir: this.photosDir, thumbnailsDir: this.thumbnailsDir }, '[ImageBackupTarget] Restoring image backup from tar.gz');

      // tar.gzを展開
      await execFileAsync('tar', ['-xzf', archivePath, '-C', tmpDir]);

      // 展開されたディレクトリを確認
      const extractedPhotosDir = path.join(tmpDir, 'photos');
      const extractedThumbnailsDir = path.join(tmpDir, 'thumbnails');

      // 既存のディレクトリをバックアップ（オプション）または削除
      // 安全のため、既存ディレクトリをリネームしてバックアップ
      const backupSuffix = `-backup-${Date.now()}`;
      try {
        await fs.access(this.photosDir);
        await fs.rename(this.photosDir, `${this.photosDir}${backupSuffix}`);
        logger?.info({ backupDir: `${this.photosDir}${backupSuffix}` }, '[ImageBackupTarget] Backed up existing photos directory');
      } catch {
        // ディレクトリが存在しない場合は何もしない
      }

      try {
        await fs.access(this.thumbnailsDir);
        await fs.rename(this.thumbnailsDir, `${this.thumbnailsDir}${backupSuffix}`);
        logger?.info({ backupDir: `${this.thumbnailsDir}${backupSuffix}` }, '[ImageBackupTarget] Backed up existing thumbnails directory');
      } catch {
        // ディレクトリが存在しない場合は何もしない
      }

      // 展開されたディレクトリを目的の場所に移動
      try {
        await fs.access(extractedPhotosDir);
        await fs.mkdir(path.dirname(this.photosDir), { recursive: true });
        await fs.rename(extractedPhotosDir, this.photosDir);
        logger?.info({ photosDir: this.photosDir }, '[ImageBackupTarget] Restored photos directory');
      } catch (error) {
        logger?.warn({ err: error, extractedPhotosDir }, '[ImageBackupTarget] Photos directory not found in backup, skipping');
      }

      try {
        await fs.access(extractedThumbnailsDir);
        await fs.mkdir(path.dirname(this.thumbnailsDir), { recursive: true });
        await fs.rename(extractedThumbnailsDir, this.thumbnailsDir);
        logger?.info({ thumbnailsDir: this.thumbnailsDir }, '[ImageBackupTarget] Restored thumbnails directory');
      } catch (error) {
        logger?.warn({ err: error, extractedThumbnailsDir }, '[ImageBackupTarget] Thumbnails directory not found in backup, skipping');
      }

      // 一時ファイルを削除
      await fs.rm(tmpDir, { recursive: true, force: true });

      logger?.info({ photosDir: this.photosDir, thumbnailsDir: this.thumbnailsDir }, '[ImageBackupTarget] Image restore completed');

      return {
        backupId: 'photo-storage',
        success: true,
        timestamp: new Date()
      };
    } catch (error) {
      // エラー時も一時ファイルを削除
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      logger?.error({ err: error }, '[ImageBackupTarget] Image restore failed');
      throw error;
    }
  }
}
