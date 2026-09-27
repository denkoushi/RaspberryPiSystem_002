import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaKnowledgeProcedureRepository } from '../prisma-knowledge-procedure.repository.js';

const enabled = process.env.KNOWLEDGE_DATABASE_TEST === '1';
// Fixed disposable loopback DB; never inherit the application's DATABASE_URL.
const db = new PrismaClient({ datasourceUrl: 'postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test' });
const repository = new PrismaKnowledgeProcedureRepository(db);

const content = (body: string) => ({ formatVersion: 1 as const, steps: [{
  id: 's1', title: '治具を準備する', body, cautions: [], needsReview: [], photos: [],
  sources: [{ kind: 'note' as const, ref: 'note-1', label: 'メモ 2026/09/20' }],
}] });
const header = (reviewTier: 'approval_required' | 'auto_publish') => ({
  title: '部品Aの段取り', category: '段取り手順', identifiers: { partNumber: 'SAMPLE-0001' }, reviewTier,
});

describe.skipIf(!enabled)('Knowledge procedure PostgreSQL contract', () => {
  beforeEach(async () => {
    await db.knowledgeProcedure.updateMany({ data: { publishedRevisionId: null } });
    await db.knowledgeProcedureRevision.deleteMany(); await db.knowledgeProcedure.deleteMany();
  });
  afterAll(async () => { await db.$disconnect(); });

  it('publishes an automatic revision and supersedes the previous one', async () => {
    const first = await repository.createDraft({ header: header('auto_publish'), content: content('一回目'), createdByKey: 'system' });
    expect(first.revisionNumber).toBe(1);
    expect(await repository.getPublished(first.procedureId)).toBeNull();
    await repository.publishAutomatic(first.revisionId);

    const second = await repository.createDraft({ procedureId: first.procedureId, header: header('auto_publish'), content: content('二回目'), createdByKey: 'system' });
    expect(second.revisionNumber).toBe(2);
    expect((await repository.getPublished(first.procedureId))!.steps[0]!.body).toBe('一回目');
    await repository.publishAutomatic(second.revisionId);

    const published = (await repository.getPublished(first.procedureId))!;
    expect(published).toMatchObject({ revisionNumber: 2, state: 'published', identifiers: { partNumber: 'SAMPLE-0001' } });
    expect(published.steps[0]!.body).toBe('二回目');
    expect((await db.knowledgeProcedureRevision.findUniqueOrThrow({ where: { id: first.revisionId } })).state).toBe('superseded');
    expect(await repository.listPublished()).toHaveLength(1);
  });

  it('never publishes a quality-critical procedure without the approval flow', async () => {
    const draft = await repository.createDraft({ header: header('approval_required'), content: content('手順'), createdByKey: 'system' });
    await expect(repository.publishAutomatic(draft.revisionId)).rejects.toThrow('PROCEDURE_REQUIRES_APPROVAL');
    expect(await repository.getPublished(draft.procedureId)).toBeNull();
  });

  it('enforces the value domains in the database as well', async () => {
    await expect(db.knowledgeProcedure.create({ data: { id: 'bad-tier', title: 't', category: 'c', reviewTier: 'skip' } })).rejects.toThrow();
  });
});
