import { prisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { FileStorageInvalidPathError } from '../file-storage/file-storage-errors.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';

export class ProcedureMaterialGcService {
  constructor(private readonly db = prisma, private readonly store: DurableFileStorePort = getFileStorageRuntime().store) {}

  async collect(now = new Date()) {
    const result = { scanned: 0, deleted: 0 };
    const entries = await this.store.list('procedure-materials');
    for (const entry of entries) {
      if (!/^[a-f0-9]{64}$/.test(entry)) continue;
      const key = `procedure-materials/${entry}/original`;
      let stat;
      try { stat = await this.store.stat(key); }
      catch (error) {
        // Listing includes files and symlinks as well as candidate directories.
        if (error instanceof FileStorageInvalidPathError || (error as NodeJS.ErrnoException).code === 'ENOTDIR') continue;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (!stat.isFile()) continue;
      result.scanned++;
      if (stat.mtimeMs >= now.getTime() - 24 * 60 * 60 * 1000) continue;
      if (await this.db.procedureMaterial.count({ where: { storageKey: key } })) continue;
      // Ingestion may have registered a reference after candidate selection.
      if (await this.db.procedureMaterial.count({ where: { storageKey: key } })) continue;
      await this.store.delete(key, { integrity: true });
      result.deleted++;
    }
    return result;
  }
}
