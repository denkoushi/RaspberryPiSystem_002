import { promises as fs } from 'fs';
import path from 'path';
import type { FileInfo, StorageProvider } from './storage-provider.interface';

const getDefaultBaseDir = (): string => {
  if (process.env.BACKUP_STORAGE_DIR) return process.env.BACKUP_STORAGE_DIR;
  if (process.env.NODE_ENV === 'test') return '/tmp/test-backups';
  return '/opt/backups';
};

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export class LocalStorageProvider implements StorageProvider {
  private readonly baseDir: string;

  constructor(options?: { baseDir?: string }) {
    this.baseDir = options?.baseDir || getDefaultBaseDir();
  }

  async upload(file: Buffer, targetPath: string): Promise<void> {
    const fullPath = path.join(this.baseDir, targetPath);
    const dir = path.dirname(fullPath);
    await ensureDir(dir);
    await fs.writeFile(fullPath, file);
  }

  async download(targetPath: string): Promise<Buffer> {
    const fullPath = path.join(this.baseDir, targetPath);
    return fs.readFile(fullPath);
  }

  async delete(targetPath: string): Promise<void> {
    const fullPath = path.join(this.baseDir, targetPath);
    await fs.rm(fullPath, { force: true });
  }

  async list(targetPath: string): Promise<FileInfo[]> {
    const fullPath = path.join(this.baseDir, targetPath);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'local-storage.provider.ts:39',message:'LocalStorageProvider.list called',data:{targetPath,baseDir:this.baseDir,fullPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    const results: FileInfo[] = [];

    const walk = async (base: string, rel: string) => {
      const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'local-storage.provider.ts:45',message:'Directory read',data:{base,rel,entriesCount:entries.length,entryNames:entries.map(e=>e.name)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'local-storage.provider.ts:53',message:'File found',data:{filePath,abs,relPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
        }
      }
    };

    await walk(fullPath, '.');
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'local-storage.provider.ts:62',message:'LocalStorageProvider.list completed',data:{targetPath,resultsCount:results.length,resultPaths:results.map(r=>r.path)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return results;
  }
}

