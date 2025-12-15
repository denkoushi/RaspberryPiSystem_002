import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'path';
import os from 'os';
import { BackupService } from '../backup.service';
import { MockStorageProvider } from '../storage/mock-storage.provider';
import type { BackupTarget, BackupTargetInfo } from '../backup-types';

class BufferTarget implements BackupTarget {
  constructor(private readonly data: Buffer, private readonly name: string) {}
  get info(): BackupTargetInfo {
    return { type: 'file', source: this.name };
  }
  async createBackup(): Promise<Buffer> {
    return Buffer.from(this.data);
  }
}

describe('BackupService integration (mock storage)', () => {
  let backupService: BackupService;
  const tmp = () => path.join(os.tmpdir(), `backup-int-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  beforeEach(() => {
    backupService = new BackupService(new MockStorageProvider());
  });

  afterEach(() => {
    // nothing to cleanup (mock)
  });

  it('uploads to mock storage and restores to disk', async () => {
    const target = new BufferTarget(Buffer.from('integration-data'), 'mock.txt');
    const result = await backupService.backup(target, { label: 'int' });
    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();

    const dest = path.join(tmp(), 'restored.txt');
    const restored = await backupService.restore(result.path!, { destination: dest });
    expect(restored.success).toBe(true);

    const fs = await import('fs/promises');
    const content = await fs.readFile(dest, 'utf-8');
    expect(content).toBe('integration-data');
  });

  it('lists and deletes backups from mock storage', async () => {
    const target = new BufferTarget(Buffer.from('list-me'), 'list.txt');
    const result = await backupService.backup(target, { label: 'int2' });
    expect(result.success).toBe(true);

    const list = await backupService.listBackups({ prefix: 'backups' });
    expect(list.some(x => x.path === result.path)).toBe(true);

    await backupService.deleteBackup(result.path!);
    const listAfter = await backupService.listBackups({ prefix: 'backups' });
    expect(listAfter.some(x => x.path === result.path)).toBe(false);
  });
});

