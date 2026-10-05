import { readdir } from 'node:fs/promises';

import { prisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';

export class ProcedureMaterialGcService {
  constructor(private readonly db = prisma, private readonly store: DurableFileStorePort = getFileStorageRuntime().store) {}

  async collect(now = new Date()) {
    const result = { scanned: 0, deleted: 0 };
    let entries;
    try {
      entries = await readdir(this.store.absolutePath('procedure-materials'), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const key = `procedure-materials/${entry.name}/original`;
      let stat;
      try { stat = await this.store.stat(key); }
      catch (error) {
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
