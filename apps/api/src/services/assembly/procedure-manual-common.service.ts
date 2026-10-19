import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { AssemblyProcedureDocumentService } from './assembly-procedure-document.service.js';
import { saveBlankProcedurePage } from './assembly-procedure-document-blank.service.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
import { COMMON_PARENT_ID, ensureProcedureManualCommonSeeded, ensureProcedureManualCommonSubject, lockProcedureManualCommon, procedureManualCommonKey } from './procedure-manual-common-rules.js';

const commonAssignments = { process: { subjectKind: 'COMMON' as const } };
const categoryWhere = { subjectKind: 'COMMON' as const, parentId: COMMON_PARENT_ID, active: true };

export class ProcedureManualCommonService {
  constructor(private readonly documents = new AssemblyProcedureDocumentService()) {}

  private choiceName(name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 20) throw new ApiError(400, '名前は1〜20文字で入力してください');
    return trimmed;
  }

  async list(published = false) {
    await ensureProcedureManualCommonSeeded();
    const [categories, actions, subjects, assignments] = await Promise.all([
      prisma.procedureManualProcess.findMany({ where: categoryWhere, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.procedureManualCommonAction.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.procedureManualCommonSubject.findMany({ orderBy: { name: 'asc' } }),
      prisma.procedureManualAssignment.findMany({ where: commonAssignments, include: {
        kioskDocument: { select: { enabled: true } },
        assemblyProcedureDocument: { select: { status: true, isActive: true, revisionRoots: { select: { document: { select: { status: true, isActive: true } } } } } }
      } })
    ]);
    const visible = assignments.filter(row => !published || row.kioskDocument?.enabled ||
      (row.assemblyProcedureDocument?.isActive && row.assemblyProcedureDocument.status === 'PUBLISHED') ||
      row.assemblyProcedureDocument?.revisionRoots.some(revision => revision.document.isActive && revision.document.status === 'PUBLISHED'));
    return {
      categories: categories.map(row => ({ ...row, count: visible.filter(item => item.processId === row.id).length, inUse: assignments.some(item => item.processId === row.id) })),
      actions: actions.map(row => ({ ...row, inUse: assignments.some(item => item.label === row.name) })),
      subjects: subjects.map(row => ({ ...row, categoryIds: [...new Set(visible.filter(item => item.modelCodeKey === row.key).map(item => item.processId))] }))
    };
  }

  async create(input: { categoryId: string; target: string; actionId: string; kanaRow?: string }) {
    const target = input.target.trim();
    const key = procedureManualCommonKey(target);
    if (!key || target.length > 179) throw new ApiError(400, '対象は1〜179文字で入力してください');
    await ensureProcedureManualCommonSeeded();
    let page: Awaited<ReturnType<typeof saveBlankProcedurePage>> | undefined;
    try {
      return await runAssemblyTransaction(async tx => {
        await lockProcedureManualCommon(tx);
        const category = await this.category(tx, input.categoryId);
        const action = await this.action(tx, input.actionId);
        if (await tx.procedureManualAssignment.findFirst({ where: { processId: category.id, modelCodeKey: key, label: action.name } })) {
          throw new ApiError(409, '同じ手順があります');
        }
        const subject = await ensureProcedureManualCommonSubject(tx, target, input.kanaRow);
        page = await saveBlankProcedurePage();
        const document = await this.documents.create({ name: `${subject.name}_${action.name}`, pages: [{ imageRelativePath: page.relativeUrl }] }, tx);
        const last = await tx.procedureManualAssignment.findFirst({ where: { processId: category.id, modelCodeKey: key }, orderBy: { sortOrder: 'desc' } });
        await tx.procedureManualAssignment.create({ data: { modelCode: subject.name, modelCodeKey: key, processId: category.id, label: action.name,
          sortOrder: (last?.sortOrder ?? -1) + 1, assemblyProcedureDocumentId: document.id } });
        return { id: document.id, modelCode: subject.name, modelCodeKey: key, processId: category.id };
      });
    } catch (error) {
      if (page) await AssemblyProcedureImageStorage.deleteImage(page.relativeUrl);
      throw error;
    }
  }

  private async category(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.procedureManualProcess.findFirst({ where: { id, ...categoryWhere } });
    if (!row) throw new ApiError(404, '分類が見つかりません');
    return row;
  }

  private async action(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.procedureManualCommonAction.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, '作業が見つかりません');
    return row;
  }

  async saveCategory(name: string, id?: string) {
    name = this.choiceName(name);
    await ensureProcedureManualCommonSeeded();
    return runAssemblyTransaction(async tx => {
      await lockProcedureManualCommon(tx);
      if (id) await this.category(tx, id);
      if (await tx.procedureManualProcess.findFirst({ where: { ...categoryWhere, name, ...(id ? { id: { not: id } } : {}) } })) throw new ApiError(409, '同じ名前があります');
      if (id) return tx.procedureManualProcess.update({ where: { id }, data: { name } });
      const last = await tx.procedureManualProcess.findFirst({ where: categoryWhere, orderBy: { sortOrder: 'desc' } });
      return tx.procedureManualProcess.create({ data: { name, parentId: COMMON_PARENT_ID, subjectKind: 'COMMON', sortOrder: (last?.sortOrder ?? -1) + 1 } });
    });
  }

  async deleteCategory(id: string) {
    await ensureProcedureManualCommonSeeded();
    return runAssemblyTransaction(async tx => {
      await lockProcedureManualCommon(tx);
      await this.category(tx, id);
      if (await tx.procedureManualAssignment.count({ where: { processId: id } })) throw new ApiError(409, '使用中の分類は削除できません');
      await tx.procedureManualProcess.delete({ where: { id } });
    });
  }

  async saveAction(name: string, id?: string) {
    name = this.choiceName(name);
    await ensureProcedureManualCommonSeeded();
    return runAssemblyTransaction(async tx => {
      await lockProcedureManualCommon(tx);
      const old = id ? await this.action(tx, id) : null;
      if (await tx.procedureManualCommonAction.findFirst({ where: { name, ...(id ? { id: { not: id } } : {}) } })) throw new ApiError(409, '同じ名前があります');
      if (!old) {
        const last = await tx.procedureManualCommonAction.findFirst({ orderBy: { sortOrder: 'desc' } });
        return tx.procedureManualCommonAction.create({ data: { name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
      }
      const rows = await tx.procedureManualAssignment.findMany({ where: { ...commonAssignments, label: old.name } });
      const renamed = new Set<string>();
      for (const row of rows) {
        if (!row.assemblyProcedureDocumentId) continue;
        const documents = await tx.assemblyProcedureDocument.findMany({ where: {
          name: `${row.modelCode}_${old.name}`, OR: [{ id: row.assemblyProcedureDocumentId }, { revisionMetadata: { is: { revisionRootId: row.assemblyProcedureDocumentId } } }]
        }, orderBy: { id: 'asc' }, select: { id: true } });
        for (const document of documents) {
          if (renamed.has(document.id)) continue;
          await tx.$queryRaw`SELECT id FROM "AssemblyProcedureDocument" WHERE id = ${document.id} FOR UPDATE`;
          const current = await tx.assemblyProcedureDocument.findUnique({ where: { id: document.id }, select: { name: true } });
          if (current?.name !== `${row.modelCode}_${old.name}`) continue;
          await this.documents.rename(document.id, `${row.modelCode}_${name}`, {}, tx);
          renamed.add(document.id);
        }
      }
      await tx.procedureManualAssignment.updateMany({ where: { ...commonAssignments, label: old.name }, data: { label: name } });
      return tx.procedureManualCommonAction.update({ where: { id: old.id }, data: { name } });
    });
  }

  async deleteAction(id: string) {
    await ensureProcedureManualCommonSeeded();
    return runAssemblyTransaction(async tx => {
      await lockProcedureManualCommon(tx);
      const action = await this.action(tx, id);
      if (await tx.procedureManualAssignment.count({ where: { ...commonAssignments, label: action.name } })) throw new ApiError(409, '使用中の作業は削除できません');
      await tx.procedureManualCommonAction.delete({ where: { id } });
    });
  }
}
