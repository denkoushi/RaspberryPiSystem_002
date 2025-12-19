import { promises as fs } from 'fs';
import path from 'path';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo } from '../backup-types.js';
import { ApiError } from '../../../lib/errors.js';

export class FileBackupTarget implements BackupTarget {
  constructor(private readonly sourcePath: string) {}

  get info(): BackupTargetInfo {
    return {
      type: 'file',
      source: path.basename(this.sourcePath)
    };
  }

  async createBackup(): Promise<Buffer> {
    try {
      // ファイルの存在確認
      await fs.access(this.sourcePath);
      return fs.readFile(this.sourcePath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ApiError(404, `バックアップ対象のファイルが見つかりません: ${this.sourcePath}`);
      }
      throw error;
    }
  }
}

