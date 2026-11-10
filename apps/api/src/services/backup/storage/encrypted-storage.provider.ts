import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  isLargeFileUploadProvider,
  type FileInfo,
  type LargeFileUploadProvider,
  type StorageProvider,
  type UploadOptions
} from './storage-provider.interface.js';
import { encryptBackup, encryptBackupFile, requireBackupEncryptionKey } from './backup-encryption.js';

/**
 * 外部ストレージへ送る前に暗号化する StorageProvider。復号は復元の信頼判定で行う。
 * 保存先のパスや一覧は変えないため、既存の保持・一覧・復元の処理はそのまま使える。
 */
export class EncryptedStorageProvider implements StorageProvider, LargeFileUploadProvider {
  constructor(
    private readonly inner: StorageProvider,
    private readonly key?: Buffer,
    private readonly tempDir: string = process.env.BACKUP_TEMP_DIR || os.tmpdir()
  ) {}

  async upload(file: Buffer, filePath: string, options?: UploadOptions): Promise<void> {
    await this.inner.upload(encryptBackup(this.key ?? requireBackupEncryptionKey(), file), filePath, options);
  }

  async uploadFromFile(sourcePath: string, filePath: string, options?: UploadOptions): Promise<void> {
    const key = this.key ?? requireBackupEncryptionKey();
    const encryptedPath = path.join(this.tempDir, `backup-encrypted-${randomUUID()}`);
    try {
      await fs.mkdir(this.tempDir, { recursive: true, mode: 0o700 });
      await encryptBackupFile(key, sourcePath, encryptedPath);
      if (isLargeFileUploadProvider(this.inner)) {
        await this.inner.uploadFromFile(encryptedPath, filePath, options);
      } else {
        await this.inner.upload(await fs.readFile(encryptedPath), filePath, options);
      }
    } finally {
      await fs.rm(encryptedPath, { force: true });
    }
  }

  download(filePath: string): Promise<Buffer> {
    return this.inner.download(filePath);
  }

  delete(filePath: string): Promise<void> {
    return this.inner.delete(filePath);
  }

  list(filePath: string): Promise<FileInfo[]> {
    return this.inner.list(filePath);
  }
}
