import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import type { BackupTarget, BackupTargetInfo } from '../backup-target.interface';

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
    
    this.info = {
      type: 'image',
      source: 'photo-storage',
      metadata: {
        ...metadata,
        label: metadata?.label as string || `images-${new Date().toISOString()}`,
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
}
