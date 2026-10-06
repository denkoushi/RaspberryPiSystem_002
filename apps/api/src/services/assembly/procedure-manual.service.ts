import { procedureVideoLinksInclude, videosForPage } from './procedure-video.service.js';
import { procedureManualApprovalInclude, serializeLastProcedureManualApproval } from './assembly-procedure-document-revision.serializer.js';
import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PdfStorageRenderAdapter } from '../kiosk-documents/adapters/pdf-storage-render.adapter.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import {
  assemblyProcedureSequenceKioskDocumentSelect,
  mapAssemblyProcedureSequenceItem
} from './assembly-procedure-sequence-item.js';
import {
  buildProcedureSteps,
  toSequenceDocument,
  type AssemblyProcedureSequence
} from './assembly-procedure-sequence.service.js';
import { runAssemblyTransaction } from './assembly-transaction.js';

export type ProcedureManualAssignmentInput = {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  sortOrder: number;
  label?: string | null;
};

const assemblyDocumentInclude = {
  procedureManualApprovals: procedureManualApprovalInclude,
  procedureVideoLinks: procedureVideoLinksInclude,
  pages: { orderBy: { pageIndex: 'asc' as const } },
  overlayElements: {
    orderBy: [{ pageIndex: 'asc' as const }, { zIndex: 'asc' as const }, { createdAt: 'asc' as const }],
    include: { asset: true }
  }
} satisfies Prisma.AssemblyProcedureDocumentInclude;

function modelKey(modelCode: string): string {
  const key = normalizeMachineNameForCompare(modelCode).trim();
  if (!key) throw new ApiError(400, '型番が必要です');
  return key;
}

export class ProcedureManualService {
  constructor(private readonly render = new PdfStorageRenderAdapter()) {}

  async listProcesses() {
    const processes = await prisma.procedureManualProcess.findMany({
      where: { active: true, OR: [{ parentId: null }, { parent: { active: true } }] },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    // Keep the existing assembly children first in the browsing list.
    return processes.sort((a, b) => Number(b.parentId === 'procedure-manual-assembly') - Number(a.parentId === 'procedure-manual-assembly'));
  }

  async listModels() {
    return prisma.procedureManualAssignment.findMany({
      distinct: ['modelCodeKey'],
      select: { modelCode: true, modelCodeKey: true },
      orderBy: [{ modelCodeKey: 'asc' }, { updatedAt: 'desc' }]
    });
  }

  private async resolvePublished(rootId: string, db: Prisma.TransactionClient = prisma) {
    const revision = await db.assemblyProcedureDocumentRevision.findFirst({
      where: { revisionRootId: rootId, document: { status: 'PUBLISHED', isActive: true } },
      orderBy: { revisionNumber: 'desc' },
      include: { document: { include: assemblyDocumentInclude } }
    });
    if (revision) return revision.document;
    // Legacy documents without a revision sidecar are their own root.
    return db.assemblyProcedureDocument.findFirst({
      where: { id: rootId, status: 'PUBLISHED', isActive: true, revisionMetadata: { is: null } },
      include: assemblyDocumentInclude
    });
  }

  async getModelOverview(modelCode: string) {
    const modelCodeKey = modelKey(modelCode);
    const [processes, rows] = await Promise.all([
      this.listProcesses(),
      prisma.procedureManualAssignment.findMany({
        where: { modelCodeKey },
        orderBy: [{ processId: 'asc' }, { sortOrder: 'asc' }],
        include: { kioskDocument: { select: assemblyProcedureSequenceKioskDocumentSelect } }
      })
    ]);
    const rootIds = [...new Set(rows.flatMap(row => row.assemblyProcedureDocumentId ? [row.assemblyProcedureDocumentId] : []))];
    const documents = rootIds.length ? await prisma.assemblyProcedureDocument.findMany({
      where: { OR: [{ id: { in: rootIds } }, { revisionMetadata: { is: { revisionRootId: { in: rootIds } } } }] },
      include: { revisionMetadata: true, editLease: true, pages: { orderBy: { pageIndex: 'asc' } } }
    }) : [];
    const families = new Map<string, typeof documents>();
    for (const document of documents) {
      const rootId = document.revisionMetadata?.revisionRootId ?? document.id;
      const family = families.get(rootId) ?? [];
      family.push(document);
      families.set(rootId, family);
    }
    const now = new Date();
    const itemsByProcess = new Map<string, ReturnType<typeof toItem>[]>();
    function toItem(row: typeof rows[number]) {
      const allRevisions = families.get(row.assemblyProcedureDocumentId ?? '') ?? [];
      const family = allRevisions
        .filter(document => document.isActive)
        .sort((a, b) => (b.revisionMetadata?.revisionNumber ?? 1) - (a.revisionMetadata?.revisionNumber ?? 1));
      const published = family.find(document => document.status === 'PUBLISHED');
      const initialDraft = family.find(document => document.status === 'DRAFT' && !document.revisionMetadata?.supersedesDocumentId);
      const draft = family.find(document => document.status === 'DRAFT' && document.revisionMetadata?.supersedesDocumentId && document.revisionMetadata.isRevisionHead);
      const display = published ?? initialDraft;
      const pdf = row.kioskDocument;
      const isPdf = Boolean(row.kioskDocumentId);
      const available = isPdf ? Boolean(pdf?.enabled) : Boolean(display);
      return {
        assignmentId: row.id, sortOrder: row.sortOrder, label: row.label,
        kind: isPdf ? 'kiosk_document' as const : 'assembly_procedure_document' as const,
        documentId: isPdf ? row.kioskDocumentId! : display?.id ?? row.assemblyProcedureDocumentId!,
        title: isPdf ? pdf?.displayTitle || pdf?.title || row.label || '文書' : display?.name ?? allRevisions[0]?.name ?? row.label ?? '文書',
        status: !available ? 'unavailable' as const : isPdf || published ? 'published' as const : 'draft' as const,
        publishedRevisionNumber: published ? published.revisionMetadata?.revisionNumber ?? 1 : null,
        draftRevision: draft ? {
          documentId: draft.id, revisionNumber: draft.revisionMetadata!.revisionNumber,
          editLease: draft.editLease && draft.editLease.expiresAt > now ? {
            holderLabel: draft.editLease.holderLabel, acquiredAt: draft.editLease.acquiredAt.toISOString()
          } : null
        } : null,
        unavailableReason: available ? null : isPdf ? 'disabled' as const : 'no_published_revision' as const,
        pageCount: isPdf ? pdf?.pageCount ?? null : display ? display.pages.length || 1 : null,
        thumbnailPageUrl: isPdf || !display ? null : display.pages[0]?.imageRelativePath ?? display.imageRelativePath
      };
    }
    for (const row of rows) {
      const items = itemsByProcess.get(row.processId) ?? [];
      items.push(toItem(row));
      itemsByProcess.set(row.processId, items);
    }
    return {
      modelCode: rows[0]?.modelCode ?? modelCodeKey, modelCodeKey,
      processes: processes.filter(process => process.parentId).map(process => {
        const items = itemsByProcess.get(process.id) ?? [];
        return { processId: process.id, count: items.length, items };
      })
    };
  }

  async getAssignments(modelCode: string, processId: string) {
    const modelCodeKey = modelKey(modelCode);
    const rows = await prisma.procedureManualAssignment.findMany({
      where: { modelCodeKey, processId },
      orderBy: { sortOrder: 'asc' },
      include: { kioskDocument: { select: assemblyProcedureSequenceKioskDocumentSelect } }
    });
    const resolved = await Promise.all(rows.map(async (row) => {
      const assemblyDocument = row.assemblyProcedureDocumentId
        ? await this.resolvePublished(row.assemblyProcedureDocumentId)
        : null;
      const available = row.kioskDocumentId ? Boolean(row.kioskDocument?.enabled) : Boolean(assemblyDocument);
      const assignment = {
        id: row.id,
        modelCode: row.modelCode,
        modelCodeKey: row.modelCodeKey,
        processId: row.processId,
        kioskDocumentId: row.kioskDocumentId,
        assemblyProcedureDocumentId: row.assemblyProcedureDocumentId,
        sortOrder: row.sortOrder,
        label: row.label,
        resolvedDocumentId: available ? (assemblyDocument?.id ?? row.kioskDocumentId) : null,
        unavailableReason: available ? null : row.assemblyProcedureDocumentId ? 'no_published_revision' as const : 'disabled' as const
      };
      if (!available) return { assignment, document: null };
      const item = mapAssemblyProcedureSequenceItem({
        ...row,
        assemblyProcedureDocumentId: assemblyDocument?.id ?? null,
        assemblyProcedureDocument: assemblyDocument
      });
      const document = await toSequenceDocument(
        item, this.render,
        new Map(assemblyDocument ? [[assemblyDocument.id, assemblyDocument.pages]] : []),
        new Map(assemblyDocument ? [[assemblyDocument.id, assemblyDocument.overlayElements]] : [])
      );
      return { assignment, document: document ? { ...document, pages: document.pages.map((page) => ({ ...page, videos: videosForPage(assemblyDocument?.procedureVideoLinks, page.pageIndex) })), lastApproval: serializeLastProcedureManualApproval(assemblyDocument?.procedureManualApprovals) } : null };
    }));
    const documents = resolved.flatMap(({ document }) => document ? [document] : []);
    const sequence: AssemblyProcedureSequence = {
      mode: 'configured',
      source: 'primary_fallback',
      machineName: rows[0]?.modelCode ?? modelCode,
      machineNameKey: modelCodeKey,
      documents,
      ...buildProcedureSteps(documents, []),
      fallbackProcedureDocument: null
    };
    return { assignments: resolved.map(({ assignment }) => assignment), sequence };
  }

  async appendDraftAssignment(modelCode: string, processId: string, documentId: string) {
    const modelCodeKey = modelKey(modelCode);
    await runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProcedureManualProcess" WHERE id = ${processId} FOR UPDATE`;
      const process = await tx.procedureManualProcess.findFirst({ where: { id: processId, active: true, parent: { active: true, parentId: null } } });
      if (!process) throw new ApiError(400, '工程が見つかりません');
      await tx.$queryRaw`SELECT id FROM "AssemblyProcedureDocument" WHERE id = ${documentId} FOR UPDATE`;
      const document = await tx.assemblyProcedureDocument.findUnique({ where: { id: documentId }, include: { revisionMetadata: true } });
      if (!document || !document.isActive) throw new ApiError(400, '手順書が見つかりません');
      const existing = await tx.procedureManualAssignment.findMany({ where: { modelCodeKey, processId }, orderBy: { sortOrder: 'desc' }, take: 1 });
      await tx.procedureManualAssignment.create({ data: {
        modelCode, modelCodeKey, processId,
        assemblyProcedureDocumentId: document.revisionMetadata?.revisionRootId ?? document.id,
        sortOrder: (existing[0]?.sortOrder ?? -1) + 1
      } });
    });
  }

  async replaceAssignments(modelCode: string, processId: string, items: ProcedureManualAssignmentInput[]) {
    const modelCodeKey = modelKey(modelCode);
    if (new Set(items.map((item) => item.sortOrder)).size !== items.length) {
      throw new ApiError(400, '並び順が重複しています');
    }
    for (const item of items) {
      if (Boolean(item.kioskDocumentId) === Boolean(item.assemblyProcedureDocumentId) ||
          !Number.isInteger(item.sortOrder) || item.sortOrder < 0) {
        throw new ApiError(400, '文書参照または並び順が不正です');
      }
    }
    await runAssemblyTransaction(async (tx) => {
      // Also serializes replacements of an empty list, where no assignment row exists to lock.
      await tx.$queryRaw`SELECT id FROM "ProcedureManualProcess" WHERE id = ${processId} FOR UPDATE`;
      const process = await tx.procedureManualProcess.findFirst({
        where: { id: processId, active: true, parent: { active: true, parentId: null } }
      });
      if (!process) throw new ApiError(400, '工程が見つかりません');
      // Use a stable order when a replacement references multiple documents.
      const ids = [...new Set(items.flatMap(item => item.assemblyProcedureDocumentId ? [item.assemblyProcedureDocumentId] : []))].sort();
      for (const id of ids) await tx.$queryRaw`SELECT id FROM "AssemblyProcedureDocument" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.procedureManualAssignment.findMany({ where: { modelCodeKey, processId }, select: { assemblyProcedureDocumentId: true, kioskDocumentId: true } });
      const existingRoots = new Set(existing.map((row) => row.assemblyProcedureDocumentId));
      const existingPdfs = new Set(existing.map((row) => row.kioskDocumentId));
      const data = await Promise.all(items.map(async (item) => {
        let rootId: string | null = null;
        if (item.assemblyProcedureDocumentId) {
          const document = await tx.assemblyProcedureDocument.findUnique({
            where: { id: item.assemblyProcedureDocumentId }, include: { revisionMetadata: true }
          });
          if (!document) throw new ApiError(400, '手順書が見つかりません');
          rootId = document.revisionMetadata?.revisionRootId ?? document.id;
          if (!existingRoots.has(rootId) && !await this.resolvePublished(rootId, tx)) throw new ApiError(400, '公開版がありません');
        } else {
          const document = await tx.kioskDocument.findFirst({ where: { id: item.kioskDocumentId!, ...(!existingPdfs.has(item.kioskDocumentId!) ? { enabled: true } : {}) } });
          if (!document) throw new ApiError(400, 'キオスク文書が見つかりません');
        }
        return {
          modelCode, modelCodeKey, processId,
          kioskDocumentId: item.kioskDocumentId ?? null,
          assemblyProcedureDocumentId: rootId,
          sortOrder: item.sortOrder, label: item.label ?? null
        };
      }));
      await tx.procedureManualAssignment.deleteMany({ where: { modelCodeKey, processId } });
      if (data.length > 0) await tx.procedureManualAssignment.createMany({ data });
    });
  }
}
