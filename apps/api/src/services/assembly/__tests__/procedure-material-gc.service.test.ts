import { mkdtemp, mkdir, rm, writeFile, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcedureMaterialGcService } from '../procedure-material-gc.service.js';

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
describe('procedure-material GC', () => {
  it('deletes only unreferenced originals older than 24 hours, retaining shared/placed/discarded references', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'procedure-material-gc-'));
    const now = new Date('2026-10-05T12:00:00Z');
    const keys = ['a', 'b', 'c', 'd'].map((c) => `procedure-materials/${c.repeat(64)}/original`);
    for (const [index, key] of keys.entries()) {
      await mkdir(path.dirname(path.join(root, key)), { recursive: true });
      await writeFile(path.join(root, key), 'original');
      const time = new Date(now.getTime() - (index < 2 ? 25 : index === 2 ? 23 : 24) * 60 * 60 * 1000);
      await utimes(path.join(root, key), time, time);
    }
    const db = { procedureMaterial: { count: vi.fn(async ({ where }: { where: { storageKey: string } }) => where.storageKey === keys[1] ? 2 : 0) } };
    const store = { absolutePath: (key: string) => path.join(root, key), stat: (key: string) => stat(path.join(root, key)), delete: vi.fn(async () => undefined) };
    expect(await new ProcedureMaterialGcService(db as never, store as never).collect(now)).toEqual({ scanned: 4, deleted: 1 });
    expect(store.delete).toHaveBeenCalledExactlyOnceWith(keys[0], { integrity: true });
    expect(db.procedureMaterial.count).toHaveBeenCalledTimes(3);
    expect(db.procedureMaterial.count).toHaveBeenCalledWith({ where: { storageKey: keys[1] } });
  });
  it('retains an original when ingestion registers a row just before deletion', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'procedure-material-gc-'));
    const key = `procedure-materials/${'a'.repeat(64)}/original`;
    await mkdir(path.dirname(path.join(root, key)), { recursive: true });
    const rows: Array<{ storageKey: string }> = [];
    const db = { procedureMaterial: { count: vi.fn(async () => rows.length) } };
    db.procedureMaterial.count.mockImplementationOnce(async () => {
      const count = rows.length;
      rows.push({ storageKey: key });
      return count;
    });
    const store = {
      absolutePath: (namespace: string) => path.join(root, namespace),
      stat: vi.fn().mockResolvedValue({ isFile: () => true, mtimeMs: 0 }),
      delete: vi.fn()
    };
    expect(await new ProcedureMaterialGcService(db as never, store as never).collect()).toEqual({ scanned: 1, deleted: 0 });
    expect(db.procedureMaterial.count).toHaveBeenCalledTimes(2);
    expect(db.procedureMaterial.count).toHaveBeenNthCalledWith(2, { where: { storageKey: key } });
    expect(store.delete).not.toHaveBeenCalled();
  });
  it('treats a missing namespace as empty', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'procedure-material-gc-'));
    const store = { absolutePath: () => path.join(root, 'missing') };
    expect(await new ProcedureMaterialGcService({} as never, store as never).collect()).toEqual({ scanned: 0, deleted: 0 });
  });
});
