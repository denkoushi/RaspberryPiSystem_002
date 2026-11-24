import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRestoreDestination, writeRestoredFile } from '../restore-destination';

describe('resolveRestoreDestination', () => {
  const base = path.resolve('/srv/backups');
  const root = path.join(base, 'restored');

  it('resolves relative names under the restored folder of the backup storage', () => {
    expect(resolveRestoreDestination('db.sql.gz', base)).toBe(path.join(root, 'db.sql.gz'));
    expect(resolveRestoreDestination('2026/db.sql.gz', base)).toBe(path.join(root, '2026', 'db.sql.gz'));
  });

  it.each(['/tmp/restored.sql.gz', '../x', 'a/../../x', 'a/..', '', '   ', 'a\0b', 'C:\\x', '.', 'dir/', 'dir\\'])(
    'rejects %j with 400',
    (destination) => {
      expect(() => resolveRestoreDestination(destination, base)).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  );
});

describe('writeRestoredFile', () => {
  let base: string;
  let outside: string;
  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-base-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-outside-'));
  });
  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('writes the file with owner-only permissions', async () => {
    const target = resolveRestoreDestination('a/b.txt', base);
    await writeRestoredFile(target, Buffer.from('ok'), base);
    expect(await fs.readFile(target, 'utf8')).toBe('ok');
    expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
  });

  it('refuses a folder link that points outside', async () => {
    await fs.mkdir(path.join(base, 'restored'), { recursive: true });
    await fs.symlink(outside, path.join(base, 'restored', 'link'));
    const target = resolveRestoreDestination('link/x.txt', base);
    await expect(writeRestoredFile(target, Buffer.from('x'), base)).rejects.toMatchObject({ statusCode: 400 });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('refuses a file link and an existing folder', async () => {
    await fs.mkdir(path.join(base, 'restored', 'dir'), { recursive: true });
    await fs.symlink(path.join(outside, 'x.txt'), path.join(base, 'restored', 'f.txt'));
    await expect(writeRestoredFile(resolveRestoreDestination('f.txt', base), Buffer.from('x'), base)).rejects.toMatchObject({ statusCode: 400 });
    await expect(writeRestoredFile(resolveRestoreDestination('dir', base), Buffer.from('x'), base)).rejects.toMatchObject({ statusCode: 400 });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('refuses when the restored folder itself is a link', async () => {
    await fs.symlink(outside, path.join(base, 'restored'));
    await expect(writeRestoredFile(resolveRestoreDestination('x.txt', base), Buffer.from('x'), base)).rejects.toMatchObject({ statusCode: 400 });
    expect(await fs.readdir(outside)).toEqual([]);
  });
});
