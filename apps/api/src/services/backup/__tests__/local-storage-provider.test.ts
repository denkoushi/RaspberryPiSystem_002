import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { LocalStorageProvider } from '../storage/local-storage.provider';

describe('LocalStorageProvider path containment', () => {
  let rootDir: string;
  let baseDir: string;
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-storage-provider-'));
    baseDir = path.join(rootDir, 'backups');
    await fs.mkdir(baseDir, { recursive: true });
    provider = new LocalStorageProvider({ baseDir });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('keeps nested and leading-slash paths inside the base directory', async () => {
    await provider.upload(Buffer.from('a'), 'database/2026/a.dump');
    await provider.upload(Buffer.from('b'), '/csv/b.csv');

    expect((await provider.download('database/2026/a.dump')).toString()).toBe('a');
    expect((await provider.download('/csv/b.csv')).toString()).toBe('b');
    const listed = (await provider.list('')).map((entry) => entry.path).sort();
    expect(listed).toEqual(['csv/b.csv', 'database/2026/a.dump']);
  });

  it('rejects paths that leave the base directory', async () => {
    const outside = path.join(rootDir, 'outside.txt');
    await fs.writeFile(outside, 'keep');

    await expect(provider.download('../outside.txt')).rejects.toThrow('Invalid backup path');
    await expect(provider.upload(Buffer.from('x'), '../outside.txt')).rejects.toThrow('Invalid backup path');
    await expect(provider.uploadFromFile(outside, 'a/../../outside.txt')).rejects.toThrow('Invalid backup path');
    await expect(provider.delete('../outside.txt')).rejects.toThrow('Invalid backup path');
    await expect(provider.list('..')).rejects.toThrow('Invalid backup path');

    expect(await fs.readFile(outside, 'utf8')).toBe('keep');
  });

  it('rejects a sibling directory that shares the base name prefix', async () => {
    await fs.mkdir(`${baseDir}-other`, { recursive: true });
    await expect(provider.upload(Buffer.from('x'), '../backups-other/x')).rejects.toThrow('Invalid backup path');
  });
});
