import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeAssetStore } from '../knowledge-asset-store.js';
import { personDestination } from '../knowledge-destination.js';
import { seedKnowledgeFields } from '../knowledge-fields.js';
import { PrismaKnowledgeIntakeRepository } from '../prisma-knowledge-intake.repository.js';
import { PrismaKnowledgeProcedureRepository } from '../prisma-knowledge-procedure.repository.js';
import { PrismaKnowledgeSubjectRepository } from '../prisma-knowledge-subject.repository.js';
import { PrismaProcedureMaterialRepository } from '../prisma-procedure-material.repository.js';
import { PrismaTriageRepository } from '../prisma-triage.repository.js';
import { KnowledgeWorker } from '../knowledge-worker.js';
import { ProcedureWorker } from '../procedure-worker.js';
import type { DurableFileStorePort } from '../../file-storage/durable-file-store.port.js';
import type { PdfKnowledgeImporter } from '../pdf-knowledge-importer.js';

const enabled = process.env.KNOWLEDGE_DATABASE_TEST === '1';
const db = new PrismaClient({ datasourceUrl: 'postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test' });
const repository = new PrismaKnowledgeIntakeRepository(db); const triage = new PrismaTriageRepository(db);
const materials = new PrismaProcedureMaterialRepository(db); const procedures = new PrismaKnowledgeProcedureRepository(db);
const subjects = new PrismaKnowledgeSubjectRepository(db);
const newTopic = (target = '休暇', workType = '各種申請', detail?: string) => personDestination({ newTopic: { target, workType, ...(detail ? { detail } : {}) } });
const receipt = (destination = newTopic()) => ({ id: randomUUID(), ownerKey: 'client:one', conversationId: randomUUID(), inputHash: randomUUID(), text: 'メモ', files: [],
  posterEmployeeId: 'e1', posterNameSnapshot: '田中', scannedPartNumber: null, destination });
const item = (text: string) => ({ source: { id: randomUUID(), text, capturedAt: new Date().toISOString(), images: [] },
  organized: { title: text, summary: text, category: 'その他', quotes: [], photos: [] } });

describe.skipIf(!enabled)('knowledge destination PostgreSQL contract', () => {
  beforeEach(async () => {
    await db.knowledgeTriage.deleteMany(); await db.knowledgeProcedureMaterial.deleteMany(); await db.knowledgeIntake.deleteMany(); await db.knowledgeTopic.deleteMany();
    await db.knowledgeProcedure.updateMany({ data: { publishedRevisionId: null } });
    await db.knowledgeProcedureRevision.deleteMany(); await db.knowledgeProcedure.deleteMany();
    await seedKnowledgeFields(db); await db.knowledgeField.updateMany({ data: { active: true } });
    await db.machine.deleteMany({ where: { equipmentManagementNumber: { startsWith: 'destination-test-' } } });
  });
  afterAll(async () => { await db.$disconnect(); });

  it('seeds once, validates active field names and saves the chosen fieldId and review tier at any depth', async () => {
    const before = await db.knowledgeField.findMany({ orderBy: { name: 'asc' } });
    await seedKnowledgeFields(db); expect(await db.knowledgeField.findMany({ orderBy: { name: 'asc' } })).toEqual(before);
    await expect(triage.validateDestination(newTopic('a', '発明'))).rejects.toThrow('UNKNOWN_KNOWLEDGE_FIELD');
    await db.knowledgeField.update({ where: { name: 'その他' }, data: { active: false } });
    await expect(triage.validateDestination(newTopic('a', 'その他'))).rejects.toThrow('UNKNOWN_KNOWLEDGE_FIELD');
    for (const [workType, reviewTier] of [['各種申請', 'auto_publish'], ['加工', 'approval_required'], ['切削', 'approval_required'], ['穴あけ・タップ', 'approval_required'], ['段取り', 'approval_required'], ['外径・内径', 'approval_required'], ['配線・配管', 'approval_required']] as const) {
      const input = receipt(newTopic('同じ対象', workType)); await repository.receive(input);
      const [decided] = await triage.get([input.id]);
      expect(await db.knowledgeProcedure.findUnique({ where: { id: decided.decidedProcedureId! } })).toMatchObject({ fieldId: before.find(field => field.name === workType)!.id, workType, reviewTier });
    }
    const partInput = receipt(personDestination({ newTopic: { target: '部品', workType: '各種申請', partNumber: 'P-1' } }));
    await repository.receive(partInput);
    expect((await db.knowledgeProcedure.findFirst({ where: { target: '部品' } }))?.reviewTier).toBe('approval_required');
  });

  it('atomically persists the destination, assigns later pages once, never offers triage and requests every rebuild', async () => {
    const input = receipt(); await repository.receive(input); await repository.receive(input);
    const [decided] = await triage.get([input.id]); const procedureId = decided.decidedProcedureId!;
    expect(decided.state).toBe('decided'); expect(await triage.awaitingFor('e1')).toEqual([]); expect(await triage.claimSuggesting('ai')).toBeNull();
    const first = item('一頁'); await materials.enqueue(input.id, [first]);
    expect((await db.knowledgeProcedure.findUniqueOrThrow({ where: { id: procedureId } })).buildRequestedAt).not.toBeNull();
    await db.knowledgeProcedure.update({ where: { id: procedureId }, data: { buildRequestedAt: null } });
    const second = item('二頁'); await materials.enqueue(input.id, [first, second]); await triage.open(input.id, 'e1');
    expect((await materials.materialsOf(procedureId, 10)).map(material => material.source.text)).toEqual(['一頁', '二頁']);
    expect((await db.knowledgeProcedure.findUniqueOrThrow({ where: { id: procedureId } })).buildRequestedAt).not.toBeNull();
    await expect(repository.receive({ ...input, inputHash: 'different', destination: { procedureId } })).rejects.toThrow('INTAKE_CONFLICT');
    expect(await db.knowledgeProcedure.count()).toBe(1);
  });

  it('recovers a worker interruption after material assignment, including multiple PDF pages, without AI suggestions', async () => {
    const pages = [item('一頁'), item('二頁')];
    const input = { ...receipt(), files: [{ id: 'pdf', key: 'key', kind: 'pdf' as const, filename: 'test.pdf' }] };
    await repository.receive(input); await repository.accepted(input.id, input.ownerKey); await repository.route(input.id, input.ownerKey, 'save');
    const enqueue = vi.fn(async (id: string, items: Parameters<typeof materials.enqueue>[1]) => { await materials.enqueue(id, items); if (enqueue.mock.calls.length === 1) throw new Error('process stopped'); });
    const organizer = { organize: vi.fn(async source => ({ title: source.text, summary: source.text, category: 'その他', quotes: [], photos: [] })) };
    const assets = new KnowledgeAssetStore({} as DurableFileStorePort); vi.spyOn(assets, 'readOriginal').mockResolvedValue(Buffer.from('%PDF-test'));
    const deps = { repository, triage, materials: { enqueue, materialsOf: materials.materialsOf.bind(materials), materialsOfIntake: materials.materialsOfIntake.bind(materials) },
      assets, organizer, inference: { classify: vi.fn(), answer: vi.fn() }, pdf: { import: vi.fn(async () => pages.map(page => page.source)) } as unknown as PdfKnowledgeImporter,
      runtime: { getMode: () => 'always_on' as const, ensureReady: async () => undefined, release: async () => undefined }, logError: vi.fn() };
    await new KnowledgeWorker(deps).tick();
    expect((await repository.get(input.id, input.ownerKey))?.state).toBe('pending');
    await db.knowledgeIntake.update({ where: { id: input.id }, data: { retryAt: new Date(0) } });
    await new KnowledgeWorker(deps).tick();
    expect((await repository.get(input.id, input.ownerKey))?.state).toBe('ready');
    const [decided] = await triage.get([input.id]); expect(await materials.materialsOf(decided.decidedProcedureId!, 10)).toHaveLength(2);
    expect(organizer.organize).toHaveBeenCalledTimes(2); expect(deps.inference.classify).not.toHaveBeenCalled();
    const inference = { suggest: vi.fn(), compose: vi.fn().mockRejectedValue(new Error('composition deferred')) };
    await new ProcedureWorker({ triage, materials, procedures, inference, workTypes: async () => [], fieldRoots: async () => ({}), scannedPartNumber: async () => null, logError: vi.fn() }).tick();
    expect(inference.suggest).not.toHaveBeenCalled(); expect(inference.compose).toHaveBeenCalledOnce();
  });

  it('reuses normalized titles under concurrent intake and triage decisions, including legacy topics', async () => {
    const legacyId = randomUUID(); await db.knowledgeProcedure.create({ data: { id: legacyId, target: ' Ｐ-Ａ ', workType: '段取り', detail: ' ｸﾗﾝﾌﾟ ', title: '旧タイトル', category: '段取り', reviewTier: 'approval_required' } });
    const first = receipt(newTopic('p-a', '段取り', 'クランプ')); const second = receipt(newTopic(' Ｐ-Ａ ', '段取り ', ' ｸﾗﾝﾌﾟ '));
    await Promise.all([repository.receive(first), repository.receive(second)]);
    expect((await triage.get([first.id, second.id])).map(row => row.decidedProcedureId)).toEqual([legacyId, legacyId]);
    expect((await db.knowledgeProcedure.findUniqueOrThrow({ where: { id: legacyId } })).fieldId).toBeNull();
    await triage.open('post-triage-1', 'e1'); await triage.open('post-triage-2', 'e2');
    const results = await Promise.all([triage.decide('post-triage-1', 'e1', newTopic('ＡＢＣ', '各種申請')), triage.decide('post-triage-2', 'e2', newTopic(' abc ', '各種申請'))]);
    expect(results[0].procedureId).toBe(results[1].procedureId); expect(await db.knowledgeProcedure.count()).toBe(2);
    const third = receipt(newTopic('abc', '各種申請')); await repository.receive(third);
    expect((await triage.get([third.id]))[0].decidedProcedureId).toBe(results[0].procedureId);
  });

  it('searches distinct subjects, counts topics, searches machine short names only with q and returns recent decisions', async () => {
    const inputs = [receipt(newTopic('P-A', '各種申請')), receipt(newTopic('P-A', '教育・技能')), receipt(newTopic('P-B', '各種申請'))];
    for (let index = 0; index < inputs.length; index++) {
      await repository.receive(inputs[index]);
      await db.knowledgeTriage.update({ where: { intakeId: inputs[index].id }, data: { decidedAt: new Date(1000 * (index + 1)) } });
    }
    await db.machine.create({ data: { equipmentManagementNumber: 'destination-test-machine', name: 'マシニング3号機', shortName: 'MC3' } });
    expect(await subjects.search('p-a')).toEqual([{ target: 'P-A', topicCount: 2 }]);
    expect(await subjects.search('mc3')).toEqual([{ target: 'マシニング3号機', topicCount: 0 }]);
    expect((await subjects.search('')).map(subject => subject.target)).not.toContain('マシニング3号機');
    expect(await subjects.recent('e1')).toEqual([{ target: 'P-B', topicCount: 1 }, { target: 'P-A', topicCount: 2 }]);
    expect(await subjects.recent('e2')).toEqual([]);
    expect((await procedures.searchTopics('', 30, 'P-A')).map(topic => topic.parts?.target)).toEqual(['P-A', 'P-A']);
    expect(await procedures.searchTopics('', 30, 'p-a')).toEqual([]);
    expect((await procedures.searchTopics('教育', 30, 'P-A'))).toHaveLength(1);
  });
});
