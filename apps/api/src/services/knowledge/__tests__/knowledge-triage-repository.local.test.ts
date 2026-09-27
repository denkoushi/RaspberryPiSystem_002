import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaKnowledgeProcedureRepository } from '../prisma-knowledge-procedure.repository.js';
import { PrismaProcedureMaterialRepository } from '../prisma-procedure-material.repository.js';
import { PrismaTriageRepository } from '../prisma-triage.repository.js';
import type { TriageSuggestions } from '../triage.port.js';

const enabled = process.env.KNOWLEDGE_DATABASE_TEST === '1';
// Fixed disposable loopback DB; never inherit the application's DATABASE_URL.
const db = new PrismaClient({ datasourceUrl: 'postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test' });
const triage = new PrismaTriageRepository(db);
const materials = new PrismaProcedureMaterialRepository(db);
const procedures = new PrismaKnowledgeProcedureRepository(db);

const item = (text: string) => ({
  source: { id: randomUUID(), text, capturedAt: '2026-09-20T01:00:00.000Z', images: [] },
  organized: { title: text, summary: text, category: '段取り', quotes: [], photos: [] },
});
const suggestions: TriageSuggestions = { candidates: [], proposal: null, confidence: 0.5 };
const content = { formatVersion: 1 as const, steps: [{ id: 's1', title: 't', body: 'b', cautions: [], needsReview: [], photos: [], sources: [{ kind: 'note' as const, ref: 'r', label: 'l' }] }] };

describe.skipIf(!enabled)('Knowledge triage PostgreSQL contract', () => {
  beforeEach(async () => {
    await db.knowledgeTriage.deleteMany(); await db.knowledgeProcedureMaterial.deleteMany();
    await db.knowledgeProcedure.updateMany({ data: { publishedRevisionId: null } });
    await db.knowledgeProcedureRevision.deleteMany(); await db.knowledgeProcedure.deleteMany();
  });
  afterAll(async () => { await db.$disconnect(); });

  it('seeds the managed work types', async () => {
    const names = (await db.knowledgeWorkType.findMany({ orderBy: { sortOrder: 'asc' } })).map(row => row.name);
    expect(names[0]).toBe('段取り'); expect(names).toContain('申し込み・手続き'); expect(names.at(-1)).toBe('その他');
  });

  it('suggests once per post, lets only the poster decide once, assigns every material and requests a rebuild', async () => {
    await materials.enqueue('post-1', [item('一頁'), item('二頁')]);
    await triage.open('post-1', 'employee-1'); await triage.open('post-1', 'employee-1');
    const claimed = (await triage.claimSuggesting('w1'))!;
    expect(claimed.intakeId).toBe('post-1'); expect(await triage.claimSuggesting('w2')).toBeNull();
    await triage.saveSuggestions('post-1', 'w1', suggestions);
    expect((await triage.awaitingFor('employee-1')).map(row => row.state)).toEqual(['awaiting']);

    await expect(triage.decide('post-1', 'employee-2', { newTopic: { parts: { target: 'A', workType: '段取り' }, identifiers: {}, reviewTier: 'approval_required' } }))
      .rejects.toThrow('TRIAGE_NOT_YOURS');
    await expect(triage.decide('post-1', 'employee-1', { newTopic: { parts: { target: 'A', workType: '発明' }, identifiers: {}, reviewTier: 'approval_required' } }))
      .rejects.toThrow('UNKNOWN_WORK_TYPE');
    const { procedureId } = await triage.decide('post-1', 'employee-1', { newTopic: { parts: { target: 'A テーブル', workType: '段取り', detail: 'クランプ' }, identifiers: { partNumber: 'P-1' }, reviewTier: 'approval_required' } });
    await expect(triage.decide('post-1', 'employee-1', { procedureId })).rejects.toThrow('TRIAGE_ALREADY_DECIDED');

    const topic = await db.knowledgeProcedure.findUniqueOrThrow({ where: { id: procedureId } });
    expect(topic).toMatchObject({ title: 'A テーブル｜段取り｜クランプ', category: '段取り', target: 'A テーブル', workType: '段取り', detail: 'クランプ', partNumber: 'P-1' });
    expect(topic.buildRequestedAt).not.toBeNull();
    expect((await materials.materialsOf(procedureId, 10)).map(material => material.source.text)).toEqual(['一頁', '二頁']);
    expect(await triage.awaitingFor('employee-1')).toEqual([]);
    expect((await procedures.searchTopics('p-1', 10)).map(record => record.parts)).toEqual([{ target: 'A テーブル', workType: '段取り', detail: 'クランプ' }]);
  });

  it('builds a requested topic once and builds again when a decision arrives during the build', async () => {
    await materials.enqueue('post-1', [item('x')]); await triage.open('post-1', 'e1');
    const { procedureId } = await triage.decide('post-1', 'e1', { newTopic: { parts: { target: '技能検定', workType: '申し込み・手続き' }, identifiers: {}, reviewTier: 'auto_publish' } });
    const job = (await procedures.claimBuild('b1'))!;
    expect(job.procedureId).toBe(procedureId); expect(await procedures.claimBuild('b2')).toBeNull();
    await materials.enqueue('post-2', [item('y')]); await triage.open('post-2', 'e1');
    await triage.decide('post-2', 'e1', { procedureId });
    const draft = await procedures.createDraft({ procedureId, header: job.header, content, createdByKey: 'test' });
    await procedures.publishAutomatic(draft.revisionId);
    await procedures.completeBuild(procedureId, 'b1', job.requestedAt);
    expect((await db.knowledgeProcedure.findUniqueOrThrow({ where: { id: procedureId } })).buildRequestedAt).not.toBeNull();
    const again = (await procedures.claimBuild('b3'))!;
    await procedures.completeBuild(procedureId, 'b3', again.requestedAt);
    expect((await db.knowledgeProcedure.findUniqueOrThrow({ where: { id: procedureId } })).buildRequestedAt).toBeNull();
  });

  it('gives up suggesting after repeated failures but still lets the poster decide', async () => {
    await triage.open('post-1', 'e1');
    await db.knowledgeTriage.update({ where: { intakeId: 'post-1' }, data: { attempts: 5 } });
    await triage.claimSuggesting('w');
    await triage.failSuggesting('post-1', 'w', 'PROCEDURE_BUILD_FAILED', false);
    expect((await triage.get(['post-1']))[0]).toMatchObject({ state: 'awaiting', suggestions: { candidates: [], proposal: null, confidence: 0 } });
  });

  it('enforces the triage state domain in the database', async () => {
    await expect(db.knowledgeTriage.create({ data: { intakeId: 'bad', state: 'lost' } })).rejects.toThrow();
  });
});
