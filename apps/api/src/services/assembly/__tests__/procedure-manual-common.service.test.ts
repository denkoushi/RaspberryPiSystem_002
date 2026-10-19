import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../../lib/assembly-procedure-image-storage.js';
import { saveBlankProcedurePage } from '../assembly-procedure-document-blank.service.js';
import { ProcedureManualCommonService } from '../procedure-manual-common.service.js';
import { COMMON_PARENT_ID, ensureProcedureManualCommonSeeded } from '../procedure-manual-common-rules.js';
import { ProcedureManualService } from '../procedure-manual.service.js';

vi.mock('../assembly-procedure-document-blank.service.js', () => ({ saveBlankProcedurePage: vi.fn() }));
const category = { id: 'tools', parentId: 'procedure-manual-common', subjectKind: 'COMMON', name: '工具', active: true, sortOrder: 0 };
const action = { id: 'use', name: '使い方', sortOrder: 0 };
const subject = { key: 'トルクレンチ', name: 'トルクレンチ', kanaRow: 'た' };
const documentId = '00000000-0000-4000-8000-000000000001';
const documents = { create: vi.fn(), rename: vi.fn() };
const service = () => new ProcedureManualCommonService(documents as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(prisma)) as never);
  vi.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
  vi.spyOn(prisma, '$executeRaw').mockResolvedValue(1);
  vi.spyOn(prisma.procedureManualProcess, 'findUnique').mockResolvedValue({ id: COMMON_PARENT_ID } as never);
  vi.spyOn(prisma.procedureManualProcess, 'findFirst').mockResolvedValue(category as never);
  vi.spyOn(prisma.procedureManualCommonAction, 'findUnique').mockResolvedValue(action as never);
  vi.spyOn(prisma.procedureManualCommonSubject, 'findUnique').mockResolvedValue(null);
  vi.spyOn(prisma.procedureManualCommonSubject, 'upsert').mockResolvedValue(subject);
  vi.spyOn(prisma.procedureManualAssignment, 'findFirst').mockResolvedValue(null);
  vi.spyOn(prisma.procedureManualAssignment, 'create').mockResolvedValue({} as never);
  vi.mocked(saveBlankProcedurePage).mockResolvedValue({ relativeUrl: '/api/storage/assembly-procedure-images/blank.png' } as never);
  documents.create.mockResolvedValue({ id: documentId });
});
afterEach(() => vi.restoreAllMocks());

describe('common manual creation', () => {
  it('atomically creates a white draft, target and classified action assignment', async () => {
    const result = await service().create({ categoryId: 'tools', target: ' トルクレンチ ', actionId: 'use' });
    expect(result).toEqual({ id: documentId, modelCode: 'トルクレンチ', modelCodeKey: 'トルクレンチ', processId: 'tools' });
    expect(documents.create.mock.calls[0][0]).toEqual({ name: 'トルクレンチ_使い方', pages: [{ imageRelativePath: '/api/storage/assembly-procedure-images/blank.png' }] });
    expect(documents.create.mock.calls[0][1]).toBe(prisma);
    expect(prisma.procedureManualAssignment.create).toHaveBeenCalledWith({ data: { modelCode: 'トルクレンチ', modelCodeKey: 'トルクレンチ', processId: 'tools', label: '使い方', sortOrder: 0, assemblyProcedureDocumentId: documentId } });
    expect(prisma.procedureManualCommonSubject.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: subject }));
  });

  it('rejects a normalized duplicate with 409 before creating any file or document', async () => {
    vi.mocked(prisma.procedureManualAssignment.findFirst).mockResolvedValue({ id: 'existing' } as never);
    await expect(service().create({ categoryId: 'tools', target: ' ｔｏｏｌ　　① ', actionId: 'use' })).rejects.toMatchObject({ statusCode: 409, message: '同じ手順があります' });
    expect(prisma.procedureManualAssignment.findFirst).toHaveBeenCalledWith({ where: { processId: 'tools', modelCodeKey: 'TOOL 1', label: '使い方' } });
    expect(saveBlankProcedurePage).not.toHaveBeenCalled(); expect(documents.create).not.toHaveBeenCalled();
  });

  it('requires a reading for a new non-kana target, but reuses known readings', async () => {
    await expect(service().create({ categoryId: 'tools', target: '研削盤', actionId: 'use' })).rejects.toThrow('よみを選んでください');
    vi.mocked(prisma.procedureManualCommonSubject.findUnique).mockResolvedValue({ key: '研削盤', name: '研削盤', kanaRow: 'か' });
    await service().create({ categoryId: 'tools', target: '研削盤', actionId: 'use' });
    expect(prisma.procedureManualCommonSubject.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ create: { key: '研削盤', name: '研削盤', kanaRow: 'か' } }));
  });

  it('cleans up its image if the atomic transaction fails after file creation', async () => {
    const remove = vi.spyOn(AssemblyProcedureImageStorage, 'deleteImage').mockResolvedValue(undefined);
    documents.create.mockRejectedValue(new Error('failure'));
    await expect(service().create({ categoryId: 'tools', target: 'トルクレンチ', actionId: 'use' })).rejects.toThrow('failure');
    expect(remove).toHaveBeenCalledWith('/api/storage/assembly-procedure-images/blank.png');
    expect(prisma.procedureManualAssignment.create).not.toHaveBeenCalled();
  });

  it.each([
    [true, 1, null, null, true], [false, 1, null, null, false],
    [true, 2, 'previous', null, false], [true, 1, null, new Date(), false]
  ])('allows only an active never-published initial COMMON draft (active=%s, revision=%s)', async (isActive, revisionNumber, supersedesDocumentId, publishedAt, accepted) => {
    vi.spyOn(prisma.procedureManualCommonAction, 'findMany').mockResolvedValue([action] as never);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue({ id: documentId, status: 'DRAFT', isActive, publishedAt, revisionMetadata: { revisionRootId: documentId, revisionNumber, supersedesDocumentId } } as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findFirst').mockResolvedValue(null);
    const remove = vi.spyOn(prisma.procedureManualAssignment, 'deleteMany').mockResolvedValue({ count: 0 });
    const create = vi.spyOn(prisma.procedureManualAssignment, 'createMany').mockResolvedValue({ count: 1 });
    const save = new ProcedureManualService().replaceAssignments('トルクレンチ', 'tools', [{ assemblyProcedureDocumentId: documentId, label: '使い方', sortOrder: 0 }]);
    if (accepted) { await save; expect(create).toHaveBeenCalled(); }
    else { await expect(save).rejects.toThrow('公開版がありません'); expect(remove).not.toHaveBeenCalled(); }
  });

  it('rejects duplicate COMMON actions in replacements before deleting the existing list', async () => {
    const remove = vi.spyOn(prisma.procedureManualAssignment, 'deleteMany');
    await expect(new ProcedureManualService().replaceAssignments('トルクレンチ', 'tools', [0, 1].map(sortOrder => ({ assemblyProcedureDocumentId: documentId, label: '使い方', sortOrder })))).rejects.toMatchObject({ statusCode: 409, message: '同じ手順があります' });
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('common category/action catalog', () => {
  it('adds and renames trimmed category names only under the common parent', async () => {
    vi.mocked(prisma.procedureManualProcess.findFirst).mockResolvedValue(null);
    const create = vi.spyOn(prisma.procedureManualProcess, 'create').mockResolvedValue(category as never);
    const update = vi.spyOn(prisma.procedureManualProcess, 'update').mockResolvedValue(category as never);
    await service().saveCategory(' 新分類 ');
    expect(create).toHaveBeenCalledWith({ data: { name: '新分類', parentId: 'procedure-manual-common', subjectKind: 'COMMON', sortOrder: 0 } });
    vi.mocked(prisma.procedureManualProcess.findFirst).mockResolvedValueOnce(category as never).mockResolvedValueOnce(null);
    await service().saveCategory(' 新工具 ', 'tools');
    expect(update).toHaveBeenCalledWith({ where: { id: 'tools' }, data: { name: '新工具' } });
  });

  it.each(['', 'a'.repeat(21)])('rejects invalid catalog name %j', async name => {
    await expect(service().saveCategory(name)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service().saveAction(name)).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each([undefined, 'tools'])('checks duplicate category names inside the common lock for create/rename (%s)', async id => {
    const create = vi.spyOn(prisma.procedureManualProcess, 'create');
    const update = vi.spyOn(prisma.procedureManualProcess, 'update');
    vi.mocked(prisma.procedureManualProcess.findFirst).mockImplementation(async args => {
      expect(prisma.$queryRaw).toHaveBeenCalled();
      return (args?.where?.name ? { ...category, id: 'duplicate' } : category) as never;
    });
    await expect(service().saveCategory('工具', id)).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.procedureManualProcess.findFirst).toHaveBeenLastCalledWith({ where: { subjectKind: 'COMMON', parentId: COMMON_PARENT_ID, active: true, name: '工具', ...(id ? { id: { not: id } } : {}) } });
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });

  it('rejects duplicate category and action names', async () => {
    await expect(service().saveCategory('工具')).rejects.toMatchObject({ statusCode: 409 });
    vi.spyOn(prisma.procedureManualCommonAction, 'findFirst').mockResolvedValue(action as never);
    await expect(service().saveAction('使い方')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects in-use deletes and deletes unused catalog entries', async () => {
    const count = vi.spyOn(prisma.procedureManualAssignment, 'count').mockResolvedValue(1);
    const categoryDelete = vi.spyOn(prisma.procedureManualProcess, 'delete').mockResolvedValue(category as never);
    const actionDelete = vi.spyOn(prisma.procedureManualCommonAction, 'delete').mockResolvedValue(action as never);
    await expect(service().deleteCategory('tools')).rejects.toMatchObject({ statusCode: 409 });
    await expect(service().deleteAction('use')).rejects.toMatchObject({ statusCode: 409 });
    expect(categoryDelete).not.toHaveBeenCalled(); expect(actionDelete).not.toHaveBeenCalled();
    expect(count).toHaveBeenLastCalledWith({ where: { process: { subjectKind: 'COMMON' }, label: '使い方' } });
    count.mockResolvedValue(0);
    await service().deleteCategory('tools'); await service().deleteAction('use');
    expect(categoryDelete).toHaveBeenCalledWith({ where: { id: 'tools' } }); expect(actionDelete).toHaveBeenCalledWith({ where: { id: 'use' } });
  });

  it('adds actions, and propagates action rename only to COMMON labels and auto-named document families via the existing rename path', async () => {
    vi.spyOn(prisma.procedureManualCommonAction, 'findFirst').mockResolvedValue(null);
    const create = vi.spyOn(prisma.procedureManualCommonAction, 'create').mockResolvedValue(action as never);
    await service().saveAction(' 新作業 ');
    expect(create).toHaveBeenCalledWith({ data: { name: '新作業', sortOrder: 0 } });
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([{ modelCode: 'トルクレンチ', assemblyProcedureDocumentId: documentId }] as never);
    const query = vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([{ id: documentId }, { id: 'revision' }] as never);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue({ name: 'トルクレンチ_使い方' } as never);
    const labels = vi.spyOn(prisma.procedureManualAssignment, 'updateMany').mockResolvedValue({ count: 1 });
    const update = vi.spyOn(prisma.procedureManualCommonAction, 'update').mockResolvedValue(action as never);
    await service().saveAction('使用方法', 'use');
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ name: 'トルクレンチ_使い方' }) }));
    expect(documents.rename.mock.calls.map(args => args.slice(0, 3))).toEqual([[documentId, 'トルクレンチ_使用方法', {}], ['revision', 'トルクレンチ_使用方法', {}]]);
    expect(documents.rename.mock.calls.every(args => args[3] === prisma)).toBe(true);
    expect(labels).toHaveBeenCalledWith({ where: { process: { subjectKind: 'COMMON' }, label: '使い方' }, data: { label: '使用方法' } });
    expect(update).toHaveBeenCalledWith({ where: { id: 'use' }, data: { name: '使用方法' } });
  });

  it('lists counts/subjects and limits published counts without losing in-use flags', async () => {
    vi.spyOn(prisma.procedureManualProcess, 'findMany').mockResolvedValue([category] as never);
    vi.spyOn(prisma.procedureManualCommonAction, 'findMany').mockResolvedValue([action] as never);
    vi.spyOn(prisma.procedureManualCommonSubject, 'findMany').mockResolvedValue([subject]);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([{ processId: 'tools', modelCodeKey: 'トルクレンチ', label: '使い方', assemblyProcedureDocument: { status: 'DRAFT', isActive: true, revisionRoots: [] } }] as never);
    expect((await service().list()).categories[0]).toMatchObject({ count: 1, inUse: true });
    expect((await service().list()).subjects[0].categoryIds).toEqual(['tools']);
    expect((await service().list(true)).categories[0]).toMatchObject({ count: 0, inUse: true });
  });
});

it('keeps common categories out of model overview while common overview includes target/category/action/reading and published filtering', async () => {
  vi.spyOn(prisma.procedureManualProcess, 'findMany').mockResolvedValue([category, { id: 'assembly', parentId: 'parent', subjectKind: 'MODEL' }] as never);
  const rows = vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([]);
  const service = new ProcedureManualService();
  expect((await service.getModelOverview('DFD1')).processes.map(row => row.processId)).toEqual(['assembly']);
  vi.spyOn(prisma.procedureManualCommonSubject, 'findMany').mockResolvedValue([subject]);
  const assignment = { id: 'one', modelCode: subject.name, modelCodeKey: subject.key, processId: 'tools', label: '使い方', assemblyProcedureDocumentId: documentId, sortOrder: 0, kioskDocumentId: null, kioskDocument: null };
  rows.mockImplementation(async args => args?.include?.process ? [] : [assignment] as never);
  vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([{ id: documentId, name: 'トルクレンチ_使い方', status: 'DRAFT', isActive: true, pages: [], revisionMetadata: null, imageRelativePath: null }] as never);
  const overview = await service.getOverview(undefined, false, 'COMMON');
  expect(overview.processes[0].items[0]).toMatchObject({ category: '工具', target: 'トルクレンチ', kanaRow: 'た', label: '使い方', subjectKind: 'COMMON', status: 'draft' });
  expect((await service.getOverview(undefined, true, 'COMMON')).processes[0].items).toEqual([]);
});


describe('common runtime seeding', () => {
  it('seeds the original catalog once and leaves deleted or renamed defaults alone', async () => {
    let parentExists = false;
    const categories = new Map<string, string>();
    const actions = new Map<string, string>();
    vi.mocked(prisma.procedureManualProcess.findUnique).mockImplementation(async () => parentExists ? { id: COMMON_PARENT_ID } as never : null);
    const parent = vi.spyOn(prisma.procedureManualProcess, 'create').mockImplementation(async () => {
      expect(prisma.$executeRaw).toHaveBeenCalled(); expect(prisma.$queryRaw).toHaveBeenCalled();
      parentExists = true; return { id: COMMON_PARENT_ID } as never;
    });
    const categorySeed = vi.spyOn(prisma.procedureManualProcess, 'createMany').mockImplementation(async args => {
      for (const row of args.data as Prisma.ProcedureManualProcessCreateManyInput[]) categories.set(row.id!, row.name);
      return { count: 6 };
    });
    const actionSeed = vi.spyOn(prisma.procedureManualCommonAction, 'createMany').mockImplementation(async args => {
      for (const row of args.data as Prisma.ProcedureManualCommonActionCreateManyInput[]) actions.set(row.id!, row.name);
      return { count: 6 };
    });
    await ensureProcedureManualCommonSeeded();
    expect(parent).toHaveBeenCalledWith({ data: { id: COMMON_PARENT_ID, name: '共通', subjectKind: 'COMMON', sortOrder: 20 } });
    expect(categorySeed).toHaveBeenCalledWith({ data: [
      ['tools', '工具'], ['cleaning', '清掃'], ['maintenance', '点検・保全'], ['safety', '安全'], ['setup', '段取り'], ['other', 'その他']
    ].map(([id, name], sortOrder) => ({ id: `${COMMON_PARENT_ID}-${id}`, name, parentId: COMMON_PARENT_ID, subjectKind: 'COMMON', sortOrder })) });
    expect(actionSeed).toHaveBeenCalledWith({ data: [
      ['use', '使い方'], ['clean', '清掃'], ['inspect', '点検'], ['replace', '交換'], ['calibrate', '校正'], ['tidy', '片付け']
    ].map(([id, name], sortOrder) => ({ id: `${COMMON_PARENT_ID}-action-${id}`, name, sortOrder })) });
    vi.mocked(prisma.$transaction).mockClear(); vi.mocked(prisma.$queryRaw).mockClear(); vi.mocked(prisma.$executeRaw).mockClear();
    vi.mocked(prisma.procedureManualProcess.findUnique).mockClear();
    await ensureProcedureManualCommonSeeded();
    expect(prisma.procedureManualProcess.findUnique).toHaveBeenCalledOnce();
    categories.delete(`${COMMON_PARENT_ID}-tools`); actions.delete(`${COMMON_PARENT_ID}-action-use`);
    categories.set(`${COMMON_PARENT_ID}-other`, '独自分類'); actions.set(`${COMMON_PARENT_ID}-action-tidy`, '独自作業');
    await ensureProcedureManualCommonSeeded();
    expect(categories.has(`${COMMON_PARENT_ID}-tools`)).toBe(false); expect(actions.has(`${COMMON_PARENT_ID}-action-use`)).toBe(false);
    expect(categories.get(`${COMMON_PARENT_ID}-other`)).toBe('独自分類'); expect(actions.get(`${COMMON_PARENT_ID}-action-tidy`)).toBe('独自作業');
    expect(parent).toHaveBeenCalledOnce(); expect(categorySeed).toHaveBeenCalledOnce(); expect(actionSeed).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(prisma.$queryRaw).not.toHaveBeenCalled(); expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('rechecks the marker after waiting for the common lock', async () => {
    vi.mocked(prisma.procedureManualProcess.findUnique).mockResolvedValueOnce(null);
    const create = vi.spyOn(prisma.procedureManualProcess, 'create');
    await ensureProcedureManualCommonSeeded();
    expect(prisma.$executeRaw).toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it('does not seed for MODEL/PART overview or replacements', async () => {
    vi.spyOn(prisma.procedureManualProcess, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.procedureManualAssignment, 'deleteMany').mockResolvedValue({ count: 0 });
    for (const subjectKind of ['MODEL', 'PART'] as const) {
      vi.mocked(prisma.procedureManualProcess.findFirst).mockResolvedValue({ ...category, subjectKind } as never);
      await new ProcedureManualService().getOverview(undefined, false, subjectKind);
      await new ProcedureManualService().replaceAssignments('tool', 'tools', []);
    }
    expect(prisma.procedureManualProcess.findUnique).not.toHaveBeenCalled(); expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

it('preserves a document name customized while action rename waits for its document lock', async () => {
  vi.spyOn(prisma.procedureManualCommonAction, 'findFirst').mockResolvedValue(null);
  vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([{ modelCode: 'トルクレンチ', assemblyProcedureDocumentId: documentId }] as never);
  let currentName = 'トルクレンチ_使い方';
  vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockImplementation(async () => {
    expect(currentName).toBe('トルクレンチ_使い方'); return [{ id: documentId }] as never;
  });
  vi.mocked(prisma.$queryRaw).mockImplementation(async (sql: unknown) => {
    if (String(sql).includes('AssemblyProcedureDocument')) currentName = '現場で付けた名前';
    return [];
  });
  const read = vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockImplementation(async () => ({ name: currentName }) as never);
  const labels = vi.spyOn(prisma.procedureManualAssignment, 'updateMany').mockResolvedValue({ count: 1 });
  vi.spyOn(prisma.procedureManualCommonAction, 'update').mockResolvedValue(action as never);
  await service().saveAction('使用方法', 'use');
  expect(read).toHaveBeenCalled(); expect(currentName).toBe('現場で付けた名前'); expect(documents.rename).not.toHaveBeenCalled();
  expect(labels).toHaveBeenCalledWith({ where: { process: { subjectKind: 'COMMON' }, label: '使い方' }, data: { label: '使用方法' } });
});

it('rejects NFKC expansion beyond 200 characters before creating a subject, image or document', async () => {
  await expect(service().create({ categoryId: 'tools', target: '㍿'.repeat(51), actionId: 'use', kanaRow: 'か' })).rejects.toMatchObject({ statusCode: 400, message: '対象が長すぎます' });
  expect(prisma.procedureManualCommonSubject.upsert).not.toHaveBeenCalled(); expect(saveBlankProcedurePage).not.toHaveBeenCalled(); expect(documents.create).not.toHaveBeenCalled();
});

it('accepts a normalized key at the 200-character boundary', async () => {
  await service().create({ categoryId: 'tools', target: '㍿'.repeat(50), actionId: 'use', kanaRow: 'か' });
  expect(prisma.procedureManualCommonSubject.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: '株式会社'.repeat(50) } }));
  expect(documents.create).toHaveBeenCalled();
});

it('rejects expanded COMMON replacement keys even for empty replacements', async () => {
  const remove = vi.spyOn(prisma.procedureManualAssignment, 'deleteMany');
  for (const items of [[], [{ assemblyProcedureDocumentId: documentId, label: '使い方', sortOrder: 0 }]]) {
    await expect(new ProcedureManualService().replaceAssignments('㍿'.repeat(51), 'tools', items)).rejects.toMatchObject({ statusCode: 400 });
  }
  expect(remove).not.toHaveBeenCalled(); expect(prisma.procedureManualCommonSubject.upsert).not.toHaveBeenCalled();
});
