import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveKnowledgeEmployee, PrismaKnowledgeReviewerRepository } from '../prisma-knowledge-reviewer.repository.js';
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
    await db.knowledgeProcedureReview.deleteMany();
    await db.knowledgePositionRank.deleteMany();
    await db.employee.deleteMany({ where: { employeeCode: { in: ['9981', '9982'] } } });
    await db.knowledgeProcedureRevision.deleteMany(); await db.knowledgeProcedure.deleteMany();
  });
  afterAll(async () => { await db.$disconnect(); });

  it('supersedes an error-reported revision when a newer automatic revision is published', async () => {
    const reporter = await db.employee.create({ data: { employeeCode: '9981', displayName: '報告者', nfcTagUid: 'TAG-9981' } });
    const first = await repository.createDraft({ header: header('auto_publish'), content: content('一回目'), createdByKey: 'system' });
    await repository.publishAutomatic(first.revisionId);
    await repository.reportError(first.procedureId, await resolveKnowledgeEmployee(db, reporter.nfcTagUid!), 'client:test', '誤り');
    const second = await repository.createDraft({ procedureId: first.procedureId, header: header('auto_publish'), content: content('二回目'), createdByKey: 'system' });
    await repository.publishAutomatic(second.revisionId);
    expect((await db.knowledgeProcedureRevision.findUniqueOrThrow({ where: { id: first.revisionId } })).state).toBe('superseded');
    expect(await repository.listPendingApproval()).toHaveLength(0);
    expect((await repository.getPublished(first.procedureId))!.revisionNumber).toBe(2);
  });

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


  const employee = async (rank = 'leader', positionName: string | null = '承認テスト主任') => {
    await db.employee.create({ data: { id: 'knowledge-reviewer-test', employeeCode: '9981', displayName: 'テスト承認者', nfcTagUid: 'knowledge-reviewer-tag', positionName } });
    if (positionName) await db.knowledgePositionRank.create({ data: { positionName, rank } });
    return resolveKnowledgeEmployee(db, 'knowledge-reviewer-tag');
  };
  const draft = (procedureId?: string, reviewTier: 'approval_required' | 'auto_publish' = 'approval_required') => repository.createDraft({ procedureId, header: header(reviewTier), content: content('手順'), createdByKey: 'system' });
  const state = async (revisionId: string) => (await db.knowledgeProcedureRevision.findUniqueOrThrow({ where: { id: revisionId } })).state;

  it('queues only the latest pending revision and returns its review document and summary', async () => {
    const first = await draft(); await repository.submitForApproval(first.revisionId);
    const second = await draft(first.procedureId); await repository.submitForApproval(second.revisionId);
    expect(await state(first.revisionId)).toBe('superseded'); expect(await repository.getForReview(first.revisionId)).toBeNull();
    const reviewer = await employee();
    await expect(repository.approve(first.revisionId, reviewer, 'client:test')).rejects.toThrow('PROCEDURE_REVIEW_CONFLICT');
    await expect(repository.returnRevision(first.revisionId, reviewer, 'client:test', '戻す')).rejects.toThrow('PROCEDURE_REVIEW_CONFLICT');
    expect(await repository.getForReview(second.revisionId)).toMatchObject({ revisionId: second.revisionId, state: 'pending_approval', steps: content('手順').steps });
    expect(await repository.listPendingApproval()).toEqual([expect.objectContaining({ procedureId: first.procedureId, revisionId: second.revisionId,
      revisionNumber: 2, title: header('approval_required').title, category: '段取り手順', identifiers: { partNumber: 'SAMPLE-0001' }, stepCount: 1, publishedRevisionNumber: null })]);
    expect(await repository.listPublished()).toEqual([]);
  });

  it.each(['leader', 'section_chief', 'manager', 'general_manager', 'executive'])('publishes with %s snapshots and supersedes the previous publication', async rank => {
    const reviewer = await employee(rank); const first = await draft(); await repository.submitForApproval(first.revisionId);
    await repository.approve(first.revisionId, reviewer, 'client:test-device', ' 確認済み ');
    const second = await draft(first.procedureId); await repository.submitForApproval(second.revisionId);
    expect((await repository.listPendingApproval())[0]).toMatchObject({ publishedRevisionNumber: 1 });
    await repository.approve(second.revisionId, reviewer, 'user:test-user');
    expect(await state(first.revisionId)).toBe('superseded'); expect(await state(second.revisionId)).toBe('published');
    expect(await repository.getPublished(first.procedureId)).toMatchObject({ revisionNumber: 2 }); expect(await repository.listPublished()).toHaveLength(1);
    expect(await db.knowledgeProcedureReview.findFirst({ where: { revisionId: first.revisionId } })).toMatchObject({
      procedureId: first.procedureId, action: 'approved', employeeId: reviewer.id, employeeCodeSnapshot: '9981', employeeNameSnapshot: 'テスト承認者',
      employeeNfcTagUidSnapshot: 'knowledge-reviewer-tag', employeePositionSnapshot: '承認テスト主任', employeeRankSnapshot: rank, actorKey: 'client:test-device', comment: '確認済み',
    });
  });

  it('returns a pending revision without changing the publication, then queues its rebuild', async () => {
    const reviewer = await employee(); const first = await draft(); await repository.submitForApproval(first.revisionId); await repository.approve(first.revisionId, reviewer, 'client:test');
    const second = await draft(first.procedureId); await repository.submitForApproval(second.revisionId);
    await expect(repository.returnRevision(second.revisionId, reviewer, 'client:test', '')).rejects.toThrow();
    expect(await state(second.revisionId)).toBe('pending_approval');
    await repository.returnRevision(second.revisionId, reviewer, 'client:test', '手順を再確認');
    expect(await state(second.revisionId)).toBe('returned'); expect(await repository.getPublished(first.procedureId)).toMatchObject({ revisionId: first.revisionId });
    expect(await db.knowledgeProcedureReview.findFirst({ where: { revisionId: second.revisionId } })).toMatchObject({ action: 'returned', comment: '手順を再確認', employeeRankSnapshot: 'leader' });
    const rebuilt = await draft(first.procedureId); await repository.submitForApproval(rebuilt.revisionId);
    expect((await repository.listPendingApproval()).map(row => row.revisionId)).toEqual([rebuilt.revisionId]);
  });

  it('withdraws an automatic publication on an error report and allows approval to republish it', async () => {
    const reviewer = await employee();
    await db.employee.create({ data: { id: 'knowledge-reporter-test', employeeCode: '9982', displayName: 'テスト報告者', nfcTagUid: 'knowledge-reporter-tag' } });
    const reporter = await resolveKnowledgeEmployee(db, 'knowledge-reporter-tag');
    const automatic = await draft(undefined, 'auto_publish'); await repository.publishAutomatic(automatic.revisionId);
    await repository.reportError(automatic.procedureId, reporter, 'client:test', '記載に誤り');
    expect(await repository.getPublished(automatic.procedureId)).toBeNull(); expect(await repository.listPublished()).toEqual([]);
    expect(await state(automatic.revisionId)).toBe('pending_approval');
    expect(await db.knowledgeProcedureReview.findFirst({ where: { revisionId: automatic.revisionId } })).toMatchObject({ action: 'error_reported', employeeId: reporter.id,
      employeeCodeSnapshot: '9982', employeeNameSnapshot: 'テスト報告者', employeeNfcTagUidSnapshot: 'knowledge-reporter-tag', employeePositionSnapshot: null, employeeRankSnapshot: 'general', comment: '記載に誤り' });
    await expect(repository.publishAutomatic(automatic.revisionId)).rejects.toThrow('PROCEDURE_REVISION_NOT_DRAFT');
    await expect(repository.reportError(automatic.procedureId, reporter, 'client:test', '再報告')).rejects.toThrow('PROCEDURE_NOT_PUBLISHED');
    await repository.approve(automatic.revisionId, reviewer, 'client:test'); expect(await repository.getPublished(automatic.procedureId)).toMatchObject({ state: 'published' });
  });

  it('lists only the latest error report for that revision, or null', async () => {
    const reviewer = await employee(); const first = await draft(); await repository.submitForApproval(first.revisionId);
    expect((await repository.listPendingApproval())[0]).toMatchObject({ revisionId: first.revisionId, reportComment: null });
    await repository.approve(first.revisionId, reviewer, 'client:test');
    await repository.reportError(first.procedureId, reviewer, 'client:test', '最初の報告');
    await db.knowledgeProcedureReview.updateMany({ where: { revisionId: first.revisionId, action: 'error_reported' }, data: { createdAt: new Date('2026-01-01') } });
    await repository.approve(first.revisionId, reviewer, 'client:test');
    await repository.reportError(first.procedureId, reviewer, 'client:test', '最新の報告');
    expect((await repository.listPendingApproval())[0]).toMatchObject({ revisionId: first.revisionId, reportComment: '最新の報告' });
    const second = await draft(first.procedureId); await repository.submitForApproval(second.revisionId);
    expect((await repository.listPendingApproval()).find(row => row.revisionId === second.revisionId)?.reportComment).toBeNull();
  });

  it('keeps a newer pending revision when an older publication is reported erroneous', async () => {
    const reviewer = await employee(); const first = await draft(); await repository.submitForApproval(first.revisionId); await repository.approve(first.revisionId, reviewer, 'client:test');
    const second = await draft(first.procedureId); await repository.submitForApproval(second.revisionId);
    await repository.reportError(first.procedureId, reviewer, 'client:test', '古い版に誤り');
    expect(await state(first.revisionId)).toBe('superseded'); expect(await state(second.revisionId)).toBe('pending_approval');
    expect((await repository.listPendingApproval()).map(row => row.revisionId)).toEqual([second.revisionId]); expect(await repository.getPublished(first.procedureId)).toBeNull();
  });

  it('rejects duplicate and concurrent approval and all non-pending states', async () => {
    const reviewer = await employee(); const row = await draft();
    await expect(repository.approve(row.revisionId, reviewer, 'client:test')).rejects.toThrow('PROCEDURE_REVIEW_CONFLICT');
    await expect(repository.returnRevision(row.revisionId, reviewer, 'client:test', '確認')).rejects.toThrow('PROCEDURE_REVIEW_CONFLICT');
    await repository.submitForApproval(row.revisionId);
    const results = await Promise.allSettled([repository.approve(row.revisionId, reviewer, 'client:test'), repository.approve(row.revisionId, reviewer, 'client:test')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: new Error('PROCEDURE_REVIEW_CONFLICT') });
    expect(await db.knowledgeProcedureReview.count({ where: { revisionId: row.revisionId } })).toBe(1);
    await expect(repository.returnRevision(row.revisionId, reviewer, 'client:test', '確認')).rejects.toThrow('PROCEDURE_REVIEW_CONFLICT');
    const returned = await draft(row.procedureId); await repository.submitForApproval(returned.revisionId); await repository.returnRevision(returned.revisionId, reviewer, 'client:test', '戻す');
    for (const revisionId of [row.revisionId, returned.revisionId]) await expect(repository.approve(revisionId, reviewer, 'client:test')).rejects.toThrow('PROCEDURE_REVIEW_CONFLICT');
    await expect(repository.returnRevision(returned.revisionId, reviewer, 'client:test', '再確認')).rejects.toThrow('PROCEDURE_REVIEW_CONFLICT');
  });

  it('rechecks current rank and roster status before mutation', async () => {
    const reviewer = await employee(); const row = await draft(); await repository.submitForApproval(row.revisionId);
    await db.knowledgePositionRank.update({ where: { positionName: '承認テスト主任' }, data: { rank: 'general' } });
    await expect(repository.approve(row.revisionId, reviewer, 'client:test')).rejects.toThrow('KNOWLEDGE_APPROVAL_FORBIDDEN');
    await db.employee.update({ where: { id: reviewer.id }, data: { status: 'INACTIVE' } });
    await expect(repository.returnRevision(row.revisionId, reviewer, 'client:test', '戻す')).rejects.toThrow('KNOWLEDGE_INACTIVE_EMPLOYEE');
    expect(await state(row.revisionId)).toBe('pending_approval'); expect(await db.knowledgeProcedureReview.count()).toBe(0);
  });

  it('queues stopped latest drafts even with a previous publication, once only', async () => {
    const reviewer = await employee(); const unpublished = await draft(); const published = await draft();
    await repository.submitForApproval(published.revisionId); await repository.approve(published.revisionId, reviewer, 'client:test');
    const newerDraft = await draft(published.procedureId);
    const obsoleteDraft = await draft(); const latest = await draft(obsoleteDraft.procedureId); await repository.submitForApproval(latest.revisionId);
    const automatic = await draft(undefined, 'auto_publish');
    await repository.submitStoppedDraftsForApproval(); const first = await repository.listPendingApproval();
    expect(first.map(row => row.revisionId).sort()).toEqual([unpublished.revisionId, newerDraft.revisionId, latest.revisionId].sort());
    expect(await state(obsoleteDraft.revisionId)).toBe('draft'); expect(await state(automatic.revisionId)).toBe('draft');
    await repository.submitStoppedDraftsForApproval(); expect(await repository.listPendingApproval()).toEqual(first);
    expect(await repository.getPublished(published.procedureId)).toMatchObject({ revisionId: published.revisionId });
  });

  it('atomically replaces all position mappings and lists unmatched roster counts', async () => {
    await employee(); const ranks = new PrismaKnowledgeReviewerRepository(db);
    await ranks.replaceRanks([{ positionName: '別職位', rank: 'section_chief' }]);
    expect(await ranks.listRanks()).toEqual({ ranks: [{ positionName: '別職位', rank: 'section_chief' }], unmappedPositions: expect.arrayContaining([{ positionName: '承認テスト主任', employeeCount: 1 }]) });
    await ranks.replaceRanks([]); expect((await ranks.listRanks()).ranks).toEqual([]);
  });

  it('enforces the value domains in the database as well', async () => {
    await expect(db.knowledgePositionRank.create({ data: { positionName: 'bad-rank', rank: 'boss' } })).rejects.toThrow();
    await expect(db.knowledgeProcedure.create({ data: { id: 'bad-tier', title: 't', category: 'c', reviewTier: 'skip' } })).rejects.toThrow();
  });
});
