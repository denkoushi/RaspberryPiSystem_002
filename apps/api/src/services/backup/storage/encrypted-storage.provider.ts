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
import { decryptBackupIfEncrypted, encryptBackup, encryptBackupFile } from './backup-encryption.js';

/**
 * 外部ストレージへ送る前に暗号化し、取得時に復号する StorageProvider。
 * 保存先のパスや一覧は変えないため、既存の保持・一覧・復元の処理はそのまま使える。
 */
export class EncryptedStorageProvider implements StorageProvider, LargeFileUploadProvider {
  constructor(
    private readonly inner: StorageProvider,
    private readonly key: Buffer,
    private readonly tempDir: string = process.env.BACKUP_TEMP_DIR || os.tmpdir()
  ) {}

  async upload(file: Buffer, filePath: string, options?: UploadOptions): Promise<void> {
    await this.inner.upload(encryptBackup(this.key, file), filePath, options);
  }

  async uploadFromFile(sourcePath: string, filePath: string, options?: UploadOptions): Promise<void> {
    const encryptedPath = path.join(this.tempDir, `backup-encrypted-${randomUUID()}`);
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      await encryptBackupFile(this.key, sourcePath, encryptedPath);
      if (isLargeFileUploadProvider(this.inner)) {
        await this.inner.uploadFromFile(encryptedPath, filePath, options);
      } else {
        await this.inner.upload(await fs.readFile(encryptedPath), filePath, options);
      }
    } finally {
      await fs.rm(encryptedPath, { force: true });
    }
  }

  async download(filePath: string): Promise<Buffer> {
    return decryptBackupIfEncrypted(this.key, await this.inner.download(filePath));
  }

  delete(filePath: string): Promise<void> {
    return this.inner.delete(filePath);
  }

  list(filePath: string): Promise<FileInfo[]> {
    return this.inner.list(filePath);
  }
}
