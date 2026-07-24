import type { AssemblyProcedureDocumentStatus, Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { runAssemblyTransaction } from './assembly-transaction.js';

const procedureDocumentInclude = {
  pages: {
    orderBy: { pageIndex: 'asc' as const }
  }
} satisfies Prisma.AssemblyProcedureDocumentInclude;

export type AssemblyProcedureDocumentRecord = Prisma.AssemblyProcedureDocumentGetPayload<{
  include: typeof procedureDocumentInclude;
}>;

export type AssemblyProcedureDocumentSummary = AssemblyProcedureDocumentRecord & {
  activeTemplateCount: number;
  totalTemplateCount: number;
};

export type AssemblyProcedureDocumentReferenceUsage = {
  inProcedureOrder: boolean;
  inTemplatePrimary: boolean;
  inActiveTemplatePrimary: boolean;
  inBoltPageRef: boolean;
  inCheckPageRef: boolean;
};

export class AssemblyProcedureDocumentService {
  private includePages = procedureDocumentInclude;

  async list(params: { includeInactive?: boolean; q?: string; limit?: number }): Promise<AssemblyProcedureDocumentRecord[]> {
    const q = params.q?.trim();
    return prisma.assemblyProcedureDocument.findMany({
      where: {
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
    const documents = await this.list(params);
    const documentIds = documents.map((document) => document.id);
    if (documentIds.length === 0) return [];

    const [totalCounts, activeCounts] = await Promise.all([
      prisma.assemblyTemplate.groupBy({
        by: ['procedureDocumentId'],
        where: { procedureDocumentId: { in: documentIds } },
        _count: { _all: true }
      }),
      prisma.assemblyTemplate.groupBy({
        by: ['procedureDocumentId'],
        where: { procedureDocumentId: { in: documentIds }, isActive: true },
        _count: { _all: true }
      })
    ]);
    const totalCountByDocument = new Map(totalCounts.map((row) => [row.procedureDocumentId, row._count._all]));
    const activeCountByDocument = new Map(activeCounts.map((row) => [row.procedureDocumentId, row._count._all]));

    return documents.map((document) => ({
      ...document,
      activeTemplateCount: activeCountByDocument.get(document.id) ?? 0,
      totalTemplateCount: totalCountByDocument.get(document.id) ?? 0
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
    pages: Array<{ imageRelativePath: string }>;
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

    return prisma.assemblyProcedureDocument.create({
      data: {
        name: name.slice(0, 200),
        imageRelativePath: params.pages[0]!.imageRelativePath,
        status: 'DRAFT',
        ...(params.source
          ? {
              sourceType: params.source.sourceType,
              gmailMessageId: params.source.gmailMessageId,
              sourceAttachmentName: params.source.sourceAttachmentName,
              gmailInternalDateMs: BigInt(params.source.gmailInternalDateMs),
              gmailDedupeKey: params.source.gmailDedupeKey
            }
          : {}),
        pages: {
          create: params.pages.map((page, pageIndex) => ({
            pageIndex,
            imageRelativePath: page.imageRelativePath
          }))
        }
      },
      include: this.includePages
    });
  }

  async findByGmailDedupeKey(gmailDedupeKey: string): Promise<AssemblyProcedureDocumentRecord | null> {
    return prisma.assemblyProcedureDocument.findUnique({
      where: { gmailDedupeKey },
      include: this.includePages
    });
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

  async publish(id: string): Promise<AssemblyProcedureDocumentRecord> {
    const doc = await this.getById(id, { includeInactive: true });
    if (!doc) throw new ApiError(404, '手順書が見つかりません');
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

  async getReferenceUsage(id: string): Promise<AssemblyProcedureDocumentReferenceUsage> {
    const [orderCount, templateCount, activeTemplateCount, boltRefCount, checkRefCount] = await Promise.all([
      prisma.assemblyProcedureOrderItem.count({ where: { assemblyProcedureDocumentId: id } }),
      prisma.assemblyTemplate.count({ where: { procedureDocumentId: id } }),
      prisma.assemblyTemplate.count({ where: { procedureDocumentId: id, isActive: true } }),
      prisma.assemblyTemplateBolt.count({ where: { assemblyProcedureDocumentId: id } }),
      prisma.assemblyTemplateCheckItem.count({ where: { assemblyProcedureDocumentId: id } })
    ]);
    return {
      inProcedureOrder: orderCount > 0,
      inTemplatePrimary: templateCount > 0,
      inActiveTemplatePrimary: activeTemplateCount > 0,
      inBoltPageRef: boltRefCount > 0,
      inCheckPageRef: checkRefCount > 0
    };
  }

  isReferenced(usage: AssemblyProcedureDocumentReferenceUsage): boolean {
    return (
      usage.inProcedureOrder ||
      usage.inTemplatePrimary ||
      usage.inActiveTemplatePrimary ||
      usage.inBoltPageRef ||
      usage.inCheckPageRef
    );
  }

  buildInUseMessage(usage: AssemblyProcedureDocumentReferenceUsage): string {
    if (usage.inProcedureOrder) return '組立の閲覧順設定で使用中の手順書は公開取り消しできません';
    if (usage.inActiveTemplatePrimary) return '有効なテンプレートで使用中の手順書は公開取り消しできません';
    if (usage.inTemplatePrimary) return 'テンプレートで使用中の手順書は公開取り消しできません';
    if (usage.inBoltPageRef || usage.inCheckPageRef) return 'マーカー参照で使用中の手順書は公開取り消しできません';
    return '使用中の手順書は公開取り消しできません';
  }

  async deleteIfUnused(id: string): Promise<'deleted' | 'not_found' | 'in_use'> {
    const imagePaths: string[] = [];
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
          pages: { select: { imageRelativePath: true } }
        }
      });
      if (!doc) return 'not_found' as const;

      const usage = await this.getReferenceUsage(id);
      if (this.isReferenced(usage)) return 'in_use' as const;

      await tx.assemblyProcedureDocument.delete({ where: { id } });
      imagePaths.push(...doc.pages.map((page) => page.imageRelativePath));
      if (!imagePaths.includes(doc.imageRelativePath)) {
        imagePaths.push(doc.imageRelativePath);
      }
      return 'deleted' as const;
    });

    if (outcome === 'deleted') {
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
