import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaKnowledgeIntakeRepository } from '../prisma-knowledge-intake.repository.js';
import { KnowledgeWorker } from '../knowledge-worker.js';
import { GitKnowledgeDocumentStore } from '../git-knowledge-document-store.js';
import { KnowledgeAssetStore } from '../knowledge-asset-store.js';
import { PdfKnowledgeImporter } from '../pdf-knowledge-importer.js';
import type { DurableFileStorePort } from '../../file-storage/durable-file-store.port.js';
import { PILOT_TOPIC } from '../knowledge-source.js';

const enabled = process.env.KNOWLEDGE_DATABASE_TEST === '1';
// Fixed disposable loopback DB; never inherit the application's DATABASE_URL.
const db = new PrismaClient({ datasourceUrl: 'postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test' });
const repository = new PrismaKnowledgeIntakeRepository(db);
const input = (ownerKey = 'client:one', conversationId = randomUUID()) => ({ id: randomUUID(), ownerKey, conversationId, inputHash: 'hash', text: '塗装のメモ', files: [] });

describe.skipIf(!enabled)('Knowledge PostgreSQL state contract', () => {
  beforeEach(async () => { await db.knowledgeIntake.deleteMany(); await db.knowledgeTopic.deleteMany(); });
  afterAll(async () => { await db.$disconnect(); });

  it('publishes a durable source once and answers from it after worker recreation', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-worker-'));
    try {
      const documents = new GitKnowledgeDocumentStore(path.join(directory, 'data.git')); await documents.initialize();
      const assets = new KnowledgeAssetStore({} as DurableFileStorePort);
      const inference = { classify: async () => 'save' as const, answer: async (_question: string, sources: unknown[]) => ({ message: `sources:${sources.length}` }) };
      const deps = { repository, documents, assets, inference,
        organizer: { organize: async () => ({ title: '塗装準備', summary: '塗装のメモ', category: '実技準備' as const, quotes: ['塗装のメモ'], photos: [] }) },
        pdf: new PdfKnowledgeImporter(assets, { extract: () => { throw new Error('unused'); } }, { runOcrOnImage: async () => ({ text: '', engine: 'test' }) }),
        runtime: { getMode: () => 'always_on' as const, ensureReady: async () => undefined, release: async () => undefined }, logError: (error: unknown) => { throw error; },
      };
      const first = input(); await repository.receive(first); await repository.accepted(first.id, first.ownerKey); await repository.route(first.id, first.ownerKey, 'save');
      await new KnowledgeWorker(deps).tick();
      const saved = (await documents.read())!;
      expect(saved.document.markdown).toContain('塗装のメモ');
      expect(await repository.publication()).toBe(saved.revision);
      expect((await repository.get(first.id, first.ownerKey))?.state).toBe('ready');
      await new KnowledgeWorker(deps).tick();
      expect((await documents.read())?.revision).toBe(saved.revision);
      const question = input(); await repository.receive(question); await repository.accepted(question.id, question.ownerKey); await repository.route(question.id, question.ownerKey, 'ask');
      await new KnowledgeWorker(deps).tick();
      expect((await repository.get(question.id, question.ownerKey))?.result?.message).toBe('sources:1');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('scopes inputs to an actor and rejects changed idempotency payloads', async () => {
    const first = input();
    expect((await repository.receive(first)).id).toBe(first.id);
    expect((await repository.receive(first)).id).toBe(first.id);
    await expect(repository.receive({ ...first, ownerKey: 'client:two' })).rejects.toThrow('INTAKE_CONFLICT');
    await expect(repository.receive({ ...first, inputHash: 'changed' })).rejects.toThrow('INTAKE_CONFLICT');
    expect(await repository.get(first.id, 'client:two')).toBeNull();
    expect(await db.knowledgeIntake.count()).toBe(1);
  });

  it('invalidates earlier choices and executes a valid choice only once', async () => {
    const first = input(); await repository.receive(first); await repository.accepted(first.id, first.ownerKey);
    await repository.route(first.id, first.ownerKey, 'clarify');
    const choice = (await repository.get(first.id, first.ownerKey))!;
    expect(await repository.choose(first.id, 'client:two', choice.version, 'save')).toBe(false);
    const second = input(first.ownerKey, first.conversationId); await repository.receive(second); await repository.accepted(second.id, second.ownerKey);
    expect(await repository.choose(first.id, first.ownerKey, choice.version, 'save')).toBe(false);
    await repository.route(second.id, second.ownerKey, 'clarify');
    const current = (await repository.get(second.id, second.ownerKey))!;
    expect(await repository.choose(second.id, second.ownerKey, current.version, 'save')).toBe(true);
    expect(await repository.choose(second.id, second.ownerKey, current.version, 'save')).toBe(false);
  });

  it('recovers a working job after lease expiry and fences the obsolete worker', async () => {
    const first = input(); await repository.receive(first); await repository.accepted(first.id, first.ownerKey);
    await repository.route(first.id, first.ownerKey, 'save');
    expect((await repository.claim('old'))?.id).toBe(first.id);
    expect(await repository.claim('other')).toBeNull();
    await db.knowledgeTopic.update({ where: { id: PILOT_TOPIC.id }, data: { leaseUntil: new Date(0) } });
    expect((await repository.claim('new'))?.id).toBe(first.id);
    expect(await repository.renew('old')).toBe(false);
    await expect(repository.finish(first.id, 'old', 'ready', 'save', { message: 'old' }, 'a'.repeat(40))).rejects.toThrow('LEASE_LOST');
    await repository.finish(first.id, 'new', 'ready', 'save', { message: 'new' }, 'b'.repeat(40));
    expect(await repository.publication()).toBe('b'.repeat(40));
    expect((await repository.get(first.id, first.ownerKey))?.result?.message).toBe('new');
  });

  it('defers busy inference without exhausting retries and restricts manual retry ownership', async () => {
    const first = input(); await repository.receive(first); await repository.accepted(first.id, first.ownerKey); await repository.route(first.id, first.ownerKey, 'save');
    await repository.claim('worker'); await repository.fail(first.id, 'worker', 'WAITING_FOR_INFERENCE', true);
    expect((await repository.get(first.id, first.ownerKey))?.attempts).toBe(0);
    await db.knowledgeIntake.update({ where: { id: first.id }, data: { state: 'failed' } });
    const current = (await repository.get(first.id, first.ownerKey))!;
    expect(await repository.retry(first.id, 'client:two', current.version)).toBe(false);
    expect(await repository.retry(first.id, first.ownerKey, current.version)).toBe(true);
  });
});
