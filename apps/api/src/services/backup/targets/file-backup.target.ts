import { promises as fs } from 'fs';
import path from 'path';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo } from '../backup-types.js';

export class FileBackupTarget implements BackupTarget {
  constructor(private readonly sourcePath: string) {}

  get info(): BackupTargetInfo {
    return {
      type: 'file',
      source: path.basename(this.sourcePath)
    };
  }

  async createBackup(): Promise<Buffer> {
    return fs.readFile(this.sourcePath);
  }
}

