import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';

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

  async retire(id: string) {
    const doc = await prisma.assemblyProcedureDocument.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!doc) return 'not_found' as const;
    await prisma.assemblyProcedureDocument.update({
      where: { id },
      data: { isActive: false }
    });
    return 'retired' as const;
  }

  async deleteImageIfUnused(imageRelativePath: string): Promise<void> {
    const count = await prisma.assemblyProcedureDocument.count({ where: { imageRelativePath } });
    if (count === 0) {
      await AssemblyProcedureImageStorage.deleteImage(imageRelativePath).catch(() => undefined);
    }
  }
}
