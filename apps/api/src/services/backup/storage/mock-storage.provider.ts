import type { FileInfo, StorageProvider } from './storage-provider.interface';

/**
 * テスト用のインメモリ実装。実際のI/Oは行わない。
 */
export class MockStorageProvider implements StorageProvider {
  private store = new Map<string, Buffer>();
  private meta = new Map<string, Date>();

  async upload(file: Buffer, path: string): Promise<void> {
    this.store.set(path, Buffer.from(file));
    this.meta.set(path, new Date());
  }

  async download(path: string): Promise<Buffer> {
    const data = this.store.get(path);
    if (!data) throw new Error(`Not found: ${path}`);
    return Buffer.from(data);
  }

  async delete(path: string): Promise<void> {
    this.store.delete(path);
    this.meta.delete(path);
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    for (const [k, v] of this.store.entries()) {
      if (!k.startsWith(prefix)) continue;
      results.push({
        path: k,
        sizeBytes: v.length,
        modifiedAt: this.meta.get(k)
      });
    }
    return results;
  }
}


