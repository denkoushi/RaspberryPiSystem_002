import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo } from '../backup-types.js';
import type { UploadSource } from '../storage/storage-provider.interface.js';

/**
 * ディレクトリ全体をtar.gzに固めて一時ファイルへ書き出すターゲット。
 * 依存を最小化するため、システムの`tar`コマンドを利用する。
 */
export class DirectoryBackupTarget implements BackupTarget {
  constructor(private readonly dirPath: string) {}

  get info(): BackupTargetInfo {
    return {
      type: 'directory',
      source: path.basename(this.dirPath)
    };
  }

  async createBackup(): Promise<Buffer> {
    const source = await this.createUploadSource();
    if (source.kind !== 'file') {
      return source.data;
    }
    try {
      return await fs.readFile(source.filePath);
    } finally {
      await source.cleanup?.().catch(() => {});
    }
  }

  async createUploadSource(): Promise<UploadSource> {
    const tempDir = process.env.BACKUP_TEMP_DIR || os.tmpdir();
    const tempFilePath = path.join(
      tempDir,
      `dir-backup-${path.basename(this.dirPath)}-${Date.now()}-${randomUUID()}.tar.gz`
    );
    try {
      await fs.mkdir(tempDir, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const tar = spawn('tar', ['-czf', tempFilePath, '-C', this.dirPath, '.'], {
          stdio: ['ignore', 'ignore', 'pipe']
        });
        let stderr = Buffer.alloc(0);
        tar.stderr.on('data', (chunk: Buffer) => {
          stderr = Buffer.from(Buffer.concat([stderr, chunk]).subarray(-8192));
        });
        tar.on('error', reject);
        tar.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`ディレクトリバックアップに失敗しました (tar exit ${code}): ${stderr.toString('utf-8')}`));
            return;
          }
          resolve();
        });
      });
      const stat = await fs.stat(tempFilePath);
      return {
        kind: 'file',
        filePath: tempFilePath,
        sizeBytes: stat.size,
        cleanup: async () => {
          await fs.rm(tempFilePath, { force: true }).catch(() => {});
        }
      };
    } catch (error) {
      await fs.rm(tempFilePath, { force: true }).catch(() => {});
      throw error;
    }
  }
}
