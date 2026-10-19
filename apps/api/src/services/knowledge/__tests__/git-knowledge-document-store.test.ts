import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitKnowledgeDocumentStore } from '../git-knowledge-document-store.js';
import { KnowledgeRevisionConflict, type KnowledgeDocument } from '../knowledge-document.js';

const document: KnowledgeDocument = {
  markdown: '# 練習\n\n元のメモ',
  report: { formatVersion: 1, topicId: 'painting', title: '練習', sections: [{
    sourceId: '123e4567-e89b-42d3-a456-426614174000', capturedAt: '2026-09-15T00:00:00.000Z', title: '準備', category: '実技準備', summary: '板を準備', originalText: '元のメモ', photos: [],
  }] },
};

describe('Dedicated knowledge Git repository (real Git)', () => {
  let directory: string;
  let store: GitKnowledgeDocumentStore;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-git-test-'));
    store = new GitKnowledgeDocumentStore(directory);
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('recovers history after a new process/adapter and makes retries idempotent', async () => {
    await store.initialize();
    expect(await store.read()).toBeNull();
    const first = await store.publish(document, null);
    expect(await store.publish(document, null)).toEqual(first);
    const changed = { ...document, markdown: '# 第二版' };
    const second = await store.publish(changed, first.revision);
    expect(second.revision).not.toBe(first.revision);
    const restarted = new GitKnowledgeDocumentStore(directory);
    await restarted.initialize();
    expect(await restarted.read()).toEqual(second);
    expect(await restarted.read(first.revision)).toEqual(first);
    expect(await readFile(path.join(directory, 'HEAD'), 'utf8')).toBe('ref: refs/heads/knowledge\n');
  });

  it('rejects a stale writer without replacing the latest accepted content', async () => {
    await store.initialize();
    const first = await store.publish(document, null);
    const second = await store.publish({ ...document, markdown: '第二版' }, first.revision);
    await expect(store.publish({ ...document, markdown: '古い処理の結果' }, first.revision)).rejects.toBeInstanceOf(KnowledgeRevisionConflict);
    expect(await store.read()).toEqual(second);
  });

  it('allows exactly one of two concurrent divergent publications', async () => {
    await store.initialize();
    const first = await store.publish(document, null);
    const results = await Promise.allSettled([
      store.publish({ ...document, markdown: 'A' }, first.revision),
      new GitKnowledgeDocumentStore(directory).publish({ ...document, markdown: 'B' }, first.revision),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(KnowledgeRevisionConflict);
    expect(['A', 'B']).toContain((await store.read())?.document.markdown);
  });

  it('refuses an existing directory owned by another application', async () => {
    await writeFile(path.join(directory, 'user-work.txt'), '保護対象');
    await expect(store.initialize()).rejects.toThrow();
    expect(await readFile(path.join(directory, 'user-work.txt'), 'utf8')).toBe('保護対象');
  });

  it('rejects ref/argument injection and arbitrary old object references', async () => {
    await store.initialize();
    await store.publish(document, null);
    await expect(store.read('--output=/tmp/invalid')).rejects.toThrow('revision');
    await expect(store.read('f'.repeat(40))).rejects.toThrow('Unknown');
  });

  it('distinguishes filesystem publication failure from a newer revision', async () => {
    await store.initialize();
    const first = await store.publish(document, null);
    const refs = path.join(directory, 'refs', 'heads');
    await chmod(refs, 0o500);
    try {
      await expect(store.publish({ ...document, markdown: 'unwritable' }, first.revision)).rejects.toThrow('publication failed');
      expect(await store.read()).toEqual(first);
    } finally { await chmod(refs, 0o700); }
  });
});
