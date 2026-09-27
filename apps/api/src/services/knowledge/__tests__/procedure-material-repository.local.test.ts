import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaKnowledgeProcedureRepository } from '../prisma-knowledge-procedure.repository.js';
import { PrismaProcedureMaterialRepository } from '../prisma-procedure-material.repository.js';

const enabled = process.env.KNOWLEDGE_DATABASE_TEST === '1';
// Fixed disposable loopback DB; never inherit the application's DATABASE_URL.
const db = new PrismaClient({ datasourceUrl: 'postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test' });
const materials = new PrismaProcedureMaterialRepository(db);
const procedures = new PrismaKnowledgeProcedureRepository(db);

const item = (text: string) => ({
  source: { id: randomUUID(), text, capturedAt: '2026-09-20T01:00:00.000Z', images: [] },
  organized: { title: text, summary: text, category: '段取り', quotes: [], photos: [] },
});

describe.skipIf(!enabled)('Procedure material queue PostgreSQL contract', () => {
  beforeEach(async () => {
    await db.knowledgeProcedureMaterial.deleteMany();
    await db.knowledgeProcedure.updateMany({ data: { publishedRevisionId: null } });
    await db.knowledgeProcedureRevision.deleteMany(); await db.knowledgeProcedure.deleteMany();
  });
  afterAll(async () => { await db.$disconnect(); });

  it('claims each material once, fences stale workers and lists assigned materials in order', async () => {
    const first = item('一つ目'); const second = item('二つ目');
    await materials.enqueue('intake-1', [first, second]);
    await materials.enqueue('intake-1', [first]);
    expect(await db.knowledgeProcedureMaterial.count()).toBe(2);

    const a = (await materials.claim('worker-a'))!;
    const b = (await materials.claim('worker-b'))!;
    expect(a.source.text).toBe('一つ目'); expect(b.source.text).toBe('二つ目');
    expect(await materials.claim('worker-c')).toBeNull();

    const { procedureId } = await procedures.createDraft({
      header: { title: '部品Aの段取り', category: '段取り', identifiers: {}, reviewTier: 'approval_required' },
      content: { formatVersion: 1, steps: [{ id: 's1', title: 't', body: 'b', cautions: [], needsReview: [], photos: [], sources: [{ kind: 'note', ref: 'r', label: 'l' }] }] },
      createdByKey: 'test',
    });
    await expect(materials.finish(a.id, 'stale', { procedureId })).rejects.toThrow('LEASE_LOST');
    await materials.finish(a.id, 'worker-a', { procedureId });
    await materials.finish(b.id, 'worker-b', { unassigned: true });
    expect((await materials.materialsOf(procedureId, 10)).map(material => material.id)).toEqual([a.id]);
  });

  it('retries failures with backoff, does not spend attempts on deferral and stops after the limit', async () => {
    await materials.enqueue('intake-1', [item('x')]);
    const claimed = (await materials.claim('w'))!;
    await materials.fail(claimed.id, 'w', 'WAITING_FOR_INFERENCE', true);
    let row = await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(row).toMatchObject({ state: 'pending', attempts: 0, leaseToken: null });
    expect(row.retryAt.getTime()).toBeGreaterThan(Date.now());

    await db.knowledgeProcedureMaterial.update({ where: { id: claimed.id }, data: { attempts: 5, retryAt: new Date(0) } });
    await materials.claim('w2');
    await materials.fail(claimed.id, 'w2', 'NO_SUPPORTED_STEPS', false);
    row = await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(row).toMatchObject({ state: 'failed', errorCode: 'NO_SUPPORTED_STEPS' });
  });

  it('enforces the state domain in the database', async () => {
    await expect(db.knowledgeProcedureMaterial.create({ data: { id: 'bad', intakeId: 'i', sourceId: 's', source: {}, organized: {}, state: 'lost' } })).rejects.toThrow();
  });
});
