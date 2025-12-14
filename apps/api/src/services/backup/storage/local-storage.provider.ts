import { promises as fs } from 'fs';
import path from 'path';
import type { FileInfo, StorageProvider } from './storage-provider.interface';

const getBaseDir = () => {
  if (process.env.BACKUP_STORAGE_DIR) return process.env.BACKUP_STORAGE_DIR;
  if (process.env.NODE_ENV === 'test') return '/tmp/test-backups';
  return '/opt/RaspberryPiSystem_002/backups';
};

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export class LocalStorageProvider implements StorageProvider {
  async upload(file: Buffer, targetPath: string): Promise<void> {
    const fullPath = path.join(getBaseDir(), targetPath);
    const dir = path.dirname(fullPath);
    await ensureDir(dir);
    await fs.writeFile(fullPath, file);
  }

  async download(targetPath: string): Promise<Buffer> {
    const fullPath = path.join(getBaseDir(), targetPath);
    return fs.readFile(fullPath);
  }

  async delete(targetPath: string): Promise<void> {
    const fullPath = path.join(getBaseDir(), targetPath);
    await fs.rm(fullPath, { force: true });
  }

  async list(targetPath: string): Promise<FileInfo[]> {
    const fullPath = path.join(getBaseDir(), targetPath);
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
          results.push({
            path: path.join(targetPath, relPath),
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

