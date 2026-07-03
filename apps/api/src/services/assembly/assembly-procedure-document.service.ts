import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';

export type AssemblyProcedureDocumentSummary = {
  id: string;
  name: string;
  imageRelativePath: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  activeTemplateCount: number;
  totalTemplateCount: number;
};

export class AssemblyProcedureDocumentService {
  async list(params: { includeInactive?: boolean; q?: string; limit?: number }) {
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
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: Math.min(Math.max(params.limit ?? 100, 1), 200)
    });
  }

  async listSummary(params: { includeInactive?: boolean; q?: string; limit?: number }): Promise<AssemblyProcedureDocumentSummary[]> {
    const q = params.q?.trim();
    const documents = await prisma.assemblyProcedureDocument.findMany({
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
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: Math.min(Math.max(params.limit ?? 100, 1), 200)
    });
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

  async getById(id: string, options: { includeInactive?: boolean } = {}) {
    return prisma.assemblyProcedureDocument.findFirst({
      where: {
        id,
        ...(options.includeInactive ? {} : { isActive: true })
      }
    });
  }

  async create(params: { name: string; imageRelativePath: string }) {
    const name = params.name.trim();
    const imageRelativePath = params.imageRelativePath.trim();
    if (!name) {
      throw new ApiError(400, '手順書名が必要です');
    }
    if (!imageRelativePath.startsWith('/api/storage/assembly-procedure-images/')) {
      throw new ApiError(400, '組立手順書画像の保存パスが不正です');
    }
    return prisma.assemblyProcedureDocument.create({
      data: {
        name: name.slice(0, 200),
        imageRelativePath
      }
    });
  }

  async rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new ApiError(400, '手順書名が必要です');
    }
    try {
      return await prisma.assemblyProcedureDocument.update({
        where: { id },
        data: { name: trimmed.slice(0, 200) }
      });
    } catch {
      throw new ApiError(404, '手順書が見つかりません');
    }
  }

  async deleteIfUnused(id: string): Promise<'deleted' | 'not_found' | 'in_use'> {
    let imageRelativePath: string | null = null;
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "AssemblyProcedureDocument"
        WHERE id = ${id}
        FOR UPDATE
      `;
      if (locked.length === 0) return 'not_found' as const;

      const doc = await tx.assemblyProcedureDocument.findUnique({
        where: { id },
        select: { imageRelativePath: true }
      });
      if (!doc) return 'not_found' as const;

      const referenceCount = await tx.assemblyTemplate.count({
        where: { procedureDocumentId: id }
      });
      if (referenceCount > 0) return 'in_use' as const;

      await tx.assemblyProcedureDocument.delete({ where: { id } });
      imageRelativePath = doc.imageRelativePath;
      return 'deleted' as const;
    });

    if (outcome === 'deleted' && imageRelativePath) {
      try {
        await AssemblyProcedureImageStorage.deleteImage(imageRelativePath);
      } catch (err) {
        logger.warn({ err, id, imageRelativePath }, 'assembly_procedure_document_image_delete_failed');
      }
    }
    return outcome;
  }

  async deleteImageIfUnused(imageRelativePath: string): Promise<void> {
    const count = await prisma.assemblyProcedureDocument.count({ where: { imageRelativePath } });
    if (count === 0) {
      await AssemblyProcedureImageStorage.deleteImage(imageRelativePath).catch(() => undefined);
    }
  }
}
