import type { AssemblyProcedureDocumentStatus, Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import {
  getAssemblyProcedureAssetGcService,
  type AssemblyProcedureAssetGcService
} from '../assembly-procedure-assets/index.js';
import { collectAssemblyProcedureAssetIds } from './assembly-procedure-document-asset-lifecycle.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
import { AssemblyTemplateAccessService } from './assembly-template-access.service.js';

const procedureDocumentInclude = {
  pages: {
    orderBy: { pageIndex: 'asc' as const }
  },
  overlayElements: {
    orderBy: [
      { pageIndex: 'asc' as const },
      { zIndex: 'asc' as const },
      { createdAt: 'asc' as const }
    ],
    include: { asset: true }
  },
  revisionMetadata: true
} satisfies Prisma.AssemblyProcedureDocumentInclude;

const procedureDocumentListInclude = {
  pages: {
    orderBy: { pageIndex: 'asc' as const }
  },
  revisionMetadata: true
} satisfies Prisma.AssemblyProcedureDocumentInclude;

export type AssemblyProcedureDocumentRecord = Prisma.AssemblyProcedureDocumentGetPayload<{
  include: typeof procedureDocumentInclude;
}>;

export type AssemblyProcedureDocumentSummary = Omit<AssemblyProcedureDocumentRecord, 'overlayElements'> & {
  activeTemplateCount: number;
  totalTemplateCount: number;
};

export type AssemblyProcedureDocumentReferenceUsage = {
  inProcedureOrder: boolean;
  inTemplatePrimary: boolean;
  inActiveTemplatePrimary: boolean;
  inTemplateProcedureSequence: boolean;
  inActiveTemplateProcedureSequence: boolean;
  inTemplateProcedureStep: boolean;
  inActiveTemplateProcedureStep: boolean;
  inBoltPageRef: boolean;
  inCheckPageRef: boolean;
  inRevisionHistory: boolean;
};

export type AssemblyProcedureAssetMetadata = {
  kind?: 'SOURCE' | 'OVERLAY_IMAGE';
  storageKey: string;
  sha256: string;
  byteSize?: number;
  /** Compatibility with the physical storage port's `size` field. */
  size?: number;
  contentType: string;
  originalFileName?: string | null;
  width?: number | null;
  height?: number | null;
};

export class AssemblyProcedureDocumentService {
  private includePages = procedureDocumentInclude;
  private readonly accessService = new AssemblyTemplateAccessService();

  constructor(
    private readonly assetGc: AssemblyProcedureAssetGcService = getAssemblyProcedureAssetGcService()
  ) {}

  async list(params: { includeInactive?: boolean; q?: string; limit?: number }): Promise<AssemblyProcedureDocumentRecord[]> {
    const q = params.q?.trim();
    return prisma.assemblyProcedureDocument.findMany({
      where: {
        OR: [
          { revisionMetadata: { is: null } },
          { revisionMetadata: { is: { isRevisionHead: true } } }
        ],
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(q
          ? {
              name: {
                contains: q,
                mode: 'insensitive'
              }
            }
          : {})
      },
      include: this.includePages,
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: Math.min(Math.max(params.limit ?? 100, 1), 200)
    });
  }

  async listSummary(params: {
    includeInactive?: boolean;
    q?: string;
    limit?: number;
  }): Promise<AssemblyProcedureDocumentSummary[]> {
    const q = params.q?.trim();
    const documents = await prisma.assemblyProcedureDocument.findMany({
      where: {
        OR: [
          { revisionMetadata: { is: null } },
          { revisionMetadata: { is: { isRevisionHead: true } } }
        ],
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(q
          ? { name: { contains: q, mode: 'insensitive' } }
          : {})
      },
      include: procedureDocumentListInclude,
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: Math.min(Math.max(params.limit ?? 100, 1), 200)
    });
    const documentIds = documents.map((document) => document.id);
    if (documentIds.length === 0) return [];

    const templateReferences = await prisma.assemblyTemplate.findMany({
      where: {
        OR: [
          { procedureDocumentId: { in: documentIds } },
          {
            procedureItems: {
              some: { assemblyProcedureDocumentId: { in: documentIds } }
            }
          },
          {
            procedureSteps: {
              some: { assemblyProcedureDocumentId: { in: documentIds } }
            }
          }
        ]
      },
      select: {
        id: true,
        isActive: true,
        procedureDocumentId: true,
        procedureItems: {
          where: { assemblyProcedureDocumentId: { in: documentIds } },
          select: { assemblyProcedureDocumentId: true }
        },
        procedureSteps: {
          where: { assemblyProcedureDocumentId: { in: documentIds } },
          select: { assemblyProcedureDocumentId: true }
        }
      }
    });
    const totalTemplateIdsByDocument = new Map<string, Set<string>>();
    const activeTemplateIdsByDocument = new Map<string, Set<string>>();
    for (const template of templateReferences) {
      const referencedDocumentIds = new Set([
        template.procedureDocumentId,
        ...template.procedureItems
          .map((item) => item.assemblyProcedureDocumentId)
          .filter((id): id is string => id != null),
        ...template.procedureSteps
          .map((step) => step.assemblyProcedureDocumentId)
          .filter((id): id is string => id != null)
      ]);
      for (const documentId of referencedDocumentIds) {
        if (!documentIds.includes(documentId)) continue;
        const totalIds = totalTemplateIdsByDocument.get(documentId) ?? new Set<string>();
        totalIds.add(template.id);
        totalTemplateIdsByDocument.set(documentId, totalIds);
        if (template.isActive) {
          const activeIds = activeTemplateIdsByDocument.get(documentId) ?? new Set<string>();
          activeIds.add(template.id);
          activeTemplateIdsByDocument.set(documentId, activeIds);
        }
      }
    }

    return documents.map((document) => ({
      ...document,
      activeTemplateCount: activeTemplateIdsByDocument.get(document.id)?.size ?? 0,
      totalTemplateCount: totalTemplateIdsByDocument.get(document.id)?.size ?? 0
    }));
  }

  async getById(id: string, options: { includeInactive?: boolean } = {}): Promise<AssemblyProcedureDocumentRecord | null> {
    return prisma.assemblyProcedureDocument.findFirst({
      where: {
        id,
        ...(options.includeInactive ? {} : { isActive: true })
      },
      include: this.includePages
    });
  }

  async create(params: {
    name: string;
    pages: Array<{ imageRelativePath: string; asset?: Omit<AssemblyProcedureAssetMetadata, 'kind'> & { kind?: 'SOURCE' } }>;
    sourceAsset?: AssemblyProcedureAssetMetadata;
    source?: {
      sourceType: 'GMAIL';
      gmailMessageId: string;
      sourceAttachmentName: string;
      gmailInternalDateMs: number;
      gmailDedupeKey: string;
    };
  }): Promise<AssemblyProcedureDocumentRecord> {
    const name = params.name.trim();
    if (!name) {
      throw new ApiError(400, '手順書名が必要です');
    }
    if (params.pages.length === 0) {
      throw new ApiError(400, '手順書ページが必要です');
    }
    for (const page of params.pages) {
      if (!page.imageRelativePath.startsWith('/api/storage/assembly-procedure-images/')) {
        throw new ApiError(400, '組立手順書画像の保存パスが不正です');
      }
    }
    const sourceAssetByteSize = params.sourceAsset
      ? params.sourceAsset.byteSize ?? params.sourceAsset.size
      : undefined;
    if (params.sourceAsset && (!sourceAssetByteSize || sourceAssetByteSize <= 0)) {
      throw new ApiError(400, '元assetサイズが不正です');
    }

    return runAssemblyTransaction(async (tx) => {
      const sourceAsset = params.sourceAsset
        ? await tx.assemblyProcedureAsset.create({
            data: {
              kind: params.sourceAsset.kind ?? 'SOURCE',
              storageKey: params.sourceAsset.storageKey,
              sha256: params.sourceAsset.sha256,
              byteSize: sourceAssetByteSize!,
              contentType: params.sourceAsset.contentType,
              originalFileName: params.sourceAsset.originalFileName ?? null,
              width: params.sourceAsset.width ?? null,
              height: params.sourceAsset.height ?? null
            }
          })
        : null;
      const document = await tx.assemblyProcedureDocument.create({
        data: {
          name: name.slice(0, 200),
          imageRelativePath: params.pages[0]!.imageRelativePath,
          status: 'DRAFT',
          ...(params.source
            ? {
                source: {
                  create: {
                    sourceType: params.source.sourceType,
                    gmailMessageId: params.source.gmailMessageId,
                    sourceAttachmentName: params.source.sourceAttachmentName,
                    gmailInternalDateMs: BigInt(params.source.gmailInternalDateMs),
                    gmailDedupeKey: params.source.gmailDedupeKey
                  }
                }
              }
            : {}),
          pages: {
            create: params.pages.map((page, pageIndex) => ({
              pageIndex,
              imageRelativePath: page.imageRelativePath
            }))
          }
        }
      });
      await tx.assemblyProcedureDocumentRevision.create({
        data: {
          documentId: document.id,
          revisionRootId: document.id,
          revisionNumber: 1,
          isRevisionHead: true,
          editVersion: 0,
          sourceAssetId: sourceAsset?.id ?? null
        }
      });
      const result = await tx.assemblyProcedureDocument.findUnique({
        where: { id: document.id },
        include: this.includePages
      });
      if (!result) throw new ApiError(500, '手順書を取得できませんでした');
      return result;
    });
  }

  async findByGmailDedupeKey(gmailDedupeKey: string): Promise<AssemblyProcedureDocumentRecord | null> {
    const source = await prisma.assemblyProcedureDocumentSourceRecord.findUnique({
      where: { gmailDedupeKey },
      select: {
        document: {
          include: this.includePages
        }
      }
    });
    return source?.document ?? null;
  }

  async rename(id: string, name: string): Promise<AssemblyProcedureDocumentRecord> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new ApiError(400, '手順書名が必要です');
    }
    try {
      return await prisma.assemblyProcedureDocument.update({
        where: { id },
        data: { name: trimmed.slice(0, 200) },
        include: this.includePages
      });
    } catch {
      throw new ApiError(404, '手順書が見つかりません');
    }
  }

  async publish(
    id: string,
    options: { accessPassword?: string; expectedEditVersion?: number } = {}
  ): Promise<AssemblyProcedureDocumentRecord> {
    await this.accessService.requireAccessPassword(options.accessPassword);
    const doc = await this.getById(id, { includeInactive: true });
    if (!doc) throw new ApiError(404, '手順書が見つかりません');
    if (doc.revisionMetadata) {
      if (!doc.revisionMetadata.isRevisionHead || !doc.isActive || doc.status !== 'DRAFT') {
        if (doc.status === 'PUBLISHED') return doc;
        throw new ApiError(409, '最新版の改版下書きだけ公開できます');
      }
      return runAssemblyTransaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ editVersion: number; isRevisionHead: boolean; isActive: boolean; status: 'DRAFT' | 'PUBLISHED' }>>`
          SELECT r."editVersion", r."isRevisionHead", d."isActive", d."status"
          FROM "AssemblyProcedureDocument" d
          JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
          WHERE d."id" = ${id}
          FOR UPDATE
        `;
        const current = locked[0];
        if (!current) throw new ApiError(404, '手順書が見つかりません');
        if (options.expectedEditVersion != null && options.expectedEditVersion !== current.editVersion) {
          throw new ApiError(409, '手順書overlayが他の編集で更新されています', { currentEditVersion: current.editVersion }, 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT');
        }
        if (!current.isRevisionHead || !current.isActive || current.status !== 'DRAFT') {
          throw new ApiError(409, '最新版の改版下書きだけ公開できます');
        }
        const updated = await tx.assemblyProcedureDocument.update({
          where: { id },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
          include: this.includePages
        });
        return updated;
      });
    }
    if (doc.status === 'PUBLISHED') return doc;
    return prisma.assemblyProcedureDocument.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date()
      },
      include: this.includePages
    });
  }

  async unpublish(id: string): Promise<AssemblyProcedureDocumentRecord> {
    const doc = await this.getById(id, { includeInactive: true });
    if (!doc) throw new ApiError(404, '手順書が見つかりません');
    if (doc.status === 'DRAFT') return doc;

    // Once a row has revision metadata it is part of the immutable version
    // history. Turning it back into a DRAFT would let callers edit a
    // published revision under the same document ID and bypass the revision
    // flow. Create a new revision instead; legacy rows without metadata keep
    // the pre-feature unpublish behaviour for compatibility.
    if (doc.revisionMetadata) {
      throw new ApiError(409, '版管理対象の公開済み手順書は公開取消できません。改版を作成してください');
    }

    const usage = await this.getReferenceUsage(id);
    if (this.isReferenced(usage)) {
      throw new ApiError(409, this.buildInUseMessage(usage));
    }

    return prisma.assemblyProcedureDocument.update({
      where: { id },
      data: {
        status: 'DRAFT',
        publishedAt: null
      },
      include: this.includePages
    });
  }

  async getReferenceUsage(
    id: string,
    tx?: Prisma.TransactionClient
  ): Promise<AssemblyProcedureDocumentReferenceUsage> {
    const db = tx ?? prisma;
    const [
      orderCount,
      templateCount,
      activeTemplateCount,
      templateSequenceCount,
      activeTemplateSequenceCount,
      templateStepCount,
      activeTemplateStepCount,
      boltRefCount,
      checkRefCount,
      revisionChildCount
    ] = await Promise.all([
      db.assemblyProcedureOrderItem.count({ where: { assemblyProcedureDocumentId: id } }),
      db.assemblyTemplate.count({ where: { procedureDocumentId: id } }),
      db.assemblyTemplate.count({ where: { procedureDocumentId: id, isActive: true } }),
      db.assemblyTemplateProcedureItem.count({ where: { assemblyProcedureDocumentId: id } }),
      db.assemblyTemplateProcedureItem.count({
        where: { assemblyProcedureDocumentId: id, template: { isActive: true } }
      }),
      db.assemblyTemplateProcedureStep.count({ where: { assemblyProcedureDocumentId: id } }),
      db.assemblyTemplateProcedureStep.count({
        where: { assemblyProcedureDocumentId: id, template: { isActive: true } }
      }),
      db.assemblyTemplateBolt.count({ where: { assemblyProcedureDocumentId: id } }),
      db.assemblyTemplateCheckItem.count({ where: { assemblyProcedureDocumentId: id } }),
      db.assemblyProcedureDocumentRevision.count({ where: { supersedesDocumentId: id } })
    ]);
    return {
      inProcedureOrder: orderCount > 0,
      inTemplatePrimary: templateCount > 0,
      inActiveTemplatePrimary: activeTemplateCount > 0,
      inTemplateProcedureSequence: templateSequenceCount > 0,
      inActiveTemplateProcedureSequence: activeTemplateSequenceCount > 0,
      inTemplateProcedureStep: templateStepCount > 0,
      inActiveTemplateProcedureStep: activeTemplateStepCount > 0,
      inBoltPageRef: boltRefCount > 0,
      inCheckPageRef: checkRefCount > 0,
      inRevisionHistory: revisionChildCount > 0
    };
  }

  isReferenced(usage: AssemblyProcedureDocumentReferenceUsage): boolean {
    return (
      usage.inProcedureOrder ||
      usage.inTemplatePrimary ||
      usage.inActiveTemplatePrimary ||
      usage.inTemplateProcedureSequence ||
      usage.inActiveTemplateProcedureSequence ||
      usage.inTemplateProcedureStep ||
      usage.inActiveTemplateProcedureStep ||
      usage.inBoltPageRef ||
      usage.inCheckPageRef ||
      usage.inRevisionHistory
    );
  }

  buildInUseMessage(usage: AssemblyProcedureDocumentReferenceUsage): string {
    if (usage.inProcedureOrder) {
      return '旧形式テンプレートの互換手順書列で使用中の手順書は公開取り消しできません';
    }
    if (usage.inActiveTemplateProcedureSequence) {
      return '有効なテンプレートの文書順で使用中の手順書は公開取り消しできません';
    }
    if (usage.inActiveTemplateProcedureStep) {
      return '有効なテンプレートの表示ステップで使用中の手順書は公開取り消しできません';
    }
    if (usage.inTemplateProcedureSequence) {
      return 'テンプレートの文書順で使用中の手順書は公開取り消しできません';
    }
    if (usage.inTemplateProcedureStep) {
      return 'テンプレートの表示ステップで使用中の手順書は公開取り消しできません';
    }
    if (usage.inActiveTemplatePrimary) return '有効なテンプレートで使用中の手順書は公開取り消しできません';
    if (usage.inTemplatePrimary) return 'テンプレートで使用中の手順書は公開取り消しできません';
    if (usage.inBoltPageRef || usage.inCheckPageRef) return 'マーカー参照で使用中の手順書は公開取り消しできません';
    if (usage.inRevisionHistory) return '版履歴で使用中の手順書は削除できません';
    return '使用中の手順書は公開取り消しできません';
  }

  async deleteIfUnused(id: string): Promise<'deleted' | 'not_found' | 'in_use'> {
    const imagePaths: string[] = [];
    const assetIds: string[] = [];
    const outcome = await runAssemblyTransaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "AssemblyProcedureDocument"
        WHERE id = ${id}
        FOR UPDATE
      `;
      if (locked.length === 0) return 'not_found' as const;

      const doc = await tx.assemblyProcedureDocument.findUnique({
        where: { id },
        select: {
          imageRelativePath: true,
          pages: { select: { imageRelativePath: true } },
          status: true,
          revisionMetadata: {
            select: {
              isRevisionHead: true,
              supersedesDocumentId: true,
              sourceAssetId: true
            }
          },
          overlayElements: {
            where: { kind: 'IMAGE' },
            select: { assetId: true }
          },
          ownedAssets: { select: { id: true } }
        }
      });
      if (!doc) return 'not_found' as const;

      const usage = await this.getReferenceUsage(id, tx);
      if (this.isReferenced(usage)) return 'in_use' as const;

      // A revision head is the stable editing/publishing target. The generic
      // delete endpoint must not remove it and leave a series without a head;
      // revision DRAFTs use the authenticated discard operation instead. A
      // root DRAFT is the one intentional exception and remains deletable
      // when it has no external references.
      if (
        doc.revisionMetadata?.isRevisionHead &&
        (doc.revisionMetadata.supersedesDocumentId || doc.status === 'PUBLISHED')
      ) {
        return 'in_use' as const;
      }

      assetIds.push(...collectAssemblyProcedureAssetIds({
        sourceAssetId: doc.revisionMetadata?.sourceAssetId,
        overlayAssetIds: doc.overlayElements.map((element) => element.assetId),
        ownedAssetIds: doc.ownedAssets.map((asset) => asset.id)
      }));

      // A self-referencing root revision row uses ON DELETE RESTRICT for the
      // root pointer. Remove that sidecar first; the root document is allowed
      // to be deleted only for the draft exception above.
      if (doc.revisionMetadata && !doc.revisionMetadata.supersedesDocumentId) {
        await tx.assemblyProcedureDocumentRevision.delete({ where: { documentId: id } });
      }

      await tx.assemblyProcedureDocument.delete({ where: { id } });
      const candidates = [...doc.pages.map((page) => page.imageRelativePath), doc.imageRelativePath];
      for (const path of candidates) {
        if (imagePaths.includes(path)) continue;
        const [pageRefs, documentRefs] = await Promise.all([
          tx.assemblyProcedureDocumentPage.count({ where: { imageRelativePath: path } }),
          tx.assemblyProcedureDocument.count({ where: { imageRelativePath: path } })
        ]);
        if (pageRefs === 0 && documentRefs === 0) imagePaths.push(path);
      }
      return 'deleted' as const;
    });

    if (outcome === 'deleted') {
      try {
        // These IDs were detached by the just-committed document deletion.
        // The GC rechecks all DB references and active-DRAFT ownership, so
        // exact candidates may be collected immediately; broad maintenance
        // GC retains its normal age safeguard.
        await this.assetGc.collect({ candidateAssetIds: assetIds, minAgeMs: 0 });
      } catch (err) {
        logger.warn({ err, id, assetIds }, 'assembly_procedure_asset_gc_after_document_delete_failed');
      }
      for (const imageRelativePath of imagePaths) {
        try {
          await AssemblyProcedureImageStorage.deleteImage(imageRelativePath);
        } catch (err) {
          logger.warn({ err, id, imageRelativePath }, 'assembly_procedure_document_image_delete_failed');
        }
      }
    }
    return outcome;
  }

  async deleteImageIfUnused(imageRelativePath: string): Promise<void> {
    const [documentCount, pageCount] = await Promise.all([
      prisma.assemblyProcedureDocument.count({ where: { imageRelativePath } }),
      prisma.assemblyProcedureDocumentPage.count({ where: { imageRelativePath } })
    ]);
    if (documentCount === 0 && pageCount === 0) {
      await AssemblyProcedureImageStorage.deleteImage(imageRelativePath).catch(() => undefined);
    }
  }

  static toStatusDto(status: AssemblyProcedureDocumentStatus): 'draft' | 'published' {
    return status === 'PUBLISHED' ? 'published' : 'draft';
  }
}
