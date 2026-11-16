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
      let originalMissing = false;
      try { stat = await this.store.stat(key); }
      catch (error) {
        // Listing includes files and symlinks as well as candidate directories.
        if (error instanceof FileStorageInvalidPathError || (error as NodeJS.ErrnoException).code === 'ENOTDIR') continue;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          const thumbnails = (await this.store.list(`procedure-materials/${entry}`)).filter(name => /^thumbnail-\d+\.webp$/.test(name));
          if (!thumbnails.length) continue;
          originalMissing = true;
          stat = await this.store.stat(`procedure-materials/${entry}/${thumbnails[0]}`);
        } else throw error;
      }
      if (!stat.isFile()) continue;
      result.scanned++;
      if (stat.mtimeMs >= now.getTime() - 24 * 60 * 60 * 1000) continue;
      if (await this.db.procedureMaterial.count({ where: { storageKey: key } })) continue;
      // Ingestion may have registered a reference after candidate selection.
      if (await this.db.procedureMaterial.count({ where: { storageKey: key } })) continue;
      const thumbnails = (await this.store.list(`procedure-materials/${entry}`)).filter(name => /^thumbnail-\d+\.webp$/.test(name));
      for (const [index, name] of thumbnails.entries()) {
        const last = originalMissing && index === thumbnails.length - 1;
        await this.store.delete(`procedure-materials/${entry}/${name}`, { integrity: true, pruneEmptyParent: last });
      }
      // Leftover thumbnails only: never delete an original that ingestion may have just written.
      if (!originalMissing) await this.store.delete(key, { integrity: true, pruneEmptyParent: true });
      result.deleted++;
    }
    return result;
  }
}
