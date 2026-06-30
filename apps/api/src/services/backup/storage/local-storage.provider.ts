import { promises as fs } from 'fs';
import path from 'path';
import type { FileInfo, LargeFileUploadProvider, StorageProvider } from './storage-provider.interface';

const getDefaultBaseDir = (): string => {
  if (process.env.BACKUP_STORAGE_DIR) return process.env.BACKUP_STORAGE_DIR;
  if (process.env.NODE_ENV === 'test') return '/tmp/test-backups';
  return '/opt/backups';
};

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export class LocalStorageProvider implements StorageProvider, LargeFileUploadProvider {
  private readonly baseDir: string;

  constructor(options?: { baseDir?: string }) {
    this.baseDir = path.resolve(options?.baseDir || getDefaultBaseDir());
  }

  private resolveTargetPath(targetPath: string): string {
    if (targetPath.includes('\0') || path.isAbsolute(targetPath)) {
      throw new Error('Invalid backup storage path');
    }

    const normalized = path.normalize(targetPath || '.');
    if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized)) {
      throw new Error('Invalid backup storage path');
    }

    const fullPath = path.resolve(this.baseDir, normalized);
    if (fullPath !== this.baseDir && !fullPath.startsWith(`${this.baseDir}${path.sep}`)) {
      throw new Error('Invalid backup storage path');
    }

    return fullPath;
  }

  async upload(file: Buffer, targetPath: string): Promise<void> {
    const fullPath = this.resolveTargetPath(targetPath);
    const dir = path.dirname(fullPath);
    await ensureDir(dir);
    await fs.writeFile(fullPath, file);
  }

  async uploadFromFile(filePath: string, targetPath: string): Promise<void> {
    const fullPath = this.resolveTargetPath(targetPath);
    const dir = path.dirname(fullPath);
    await ensureDir(dir);
    await fs.copyFile(filePath, fullPath);
  }

  async download(targetPath: string): Promise<Buffer> {
    const fullPath = this.resolveTargetPath(targetPath);
    return fs.readFile(fullPath);
  }

  async delete(targetPath: string): Promise<void> {
    const fullPath = this.resolveTargetPath(targetPath);
    await fs.rm(fullPath, { force: true });
    
    // ファイル削除後、親ディレクトリが空なら削除を試みる
    const parentDir = path.dirname(fullPath);
    if (parentDir !== this.baseDir && parentDir.startsWith(this.baseDir)) {
      try {
        const entries = await fs.readdir(parentDir);
        if (entries.length === 0) {
          await fs.rmdir(parentDir);
        }
      } catch {
        // ディレクトリ削除失敗は無視（権限問題など）
      }
    }
  }

  async list(targetPath: string): Promise<FileInfo[]> {
    const fullPath = this.resolveTargetPath(targetPath);
    const results: FileInfo[] = [];

    const walk = async (base: string, rel: string) => {
      const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const abs = path.join(base, entry.name);
        const relPath = path.join(rel, entry.name);
        if (entry.isDirectory()) {
          await walk(abs, relPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(abs);
          const filePath = path.join(targetPath, relPath);
          results.push({
            path: filePath,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime
          });
        }
      }
    };

    await walk(fullPath, '.');
    return results;
  }
}
