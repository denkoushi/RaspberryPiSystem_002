import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BackupTarget } from '../backup-target.interface';
import type { BackupTargetInfo } from '../backup-types';

const execFileAsync = promisify(execFile);

/**
 * ディレクトリ全体をtar.gzに固めて返すターゲット。
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
    const tmpFile = path.join(
      os.tmpdir(),
      `backup-${Date.now()}-${Math.random().toString(16).slice(2)}.tar.gz`
    );

    try {
      await execFileAsync('tar', ['-czf', tmpFile, '-C', this.dirPath, '.'], {
        maxBuffer: 1024 * 1024 * 200
      });
      const data = await fs.readFile(tmpFile);
      return data;
    } finally {
      await fs.rm(tmpFile, { force: true }).catch(() => {});
    }
  }
}

