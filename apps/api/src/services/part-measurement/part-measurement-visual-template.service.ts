import type { Prisma } from '@prisma/client';

import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

const VISUAL_TEMPLATE_MISSING_MESSAGE = 'visual template が見つからないか無効です';

/** テンプレ紐付けと未使用削除が同じ visual 行で直列化されるようロックする */
export async function lockActiveVisualTemplateForBindingInTransaction(
  tx: Prisma.TransactionClient,
  visualTemplateId: string
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "PartMeasurementVisualTemplate"
    WHERE id = ${visualTemplateId}
    FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new ApiError(400, VISUAL_TEMPLATE_MISSING_MESSAGE);
  }
  const visual = await tx.partMeasurementVisualTemplate.findFirst({
    where: { id: visualTemplateId, isActive: true }
  });
  if (!visual) {
    throw new ApiError(400, VISUAL_TEMPLATE_MISSING_MESSAGE);
  }
}

const VISUAL_TEMPLATE_LIST_MAX_LIMIT = 200;

export type PartMeasurementVisualTemplateListSort = 'name' | 'recentlyUpdated';

export type PartMeasurementVisualTemplateListParams = {
  includeInactive?: boolean;
  /** 図面名の部分一致（大文字小文字無視） */
  q?: string;
  /** 未指定時は件数制限なし（管理画面の全件一覧互換） */
  limit?: number;
  /** 未指定時は name asc（既存ピッカー・管理画面互換） */
  sort?: PartMeasurementVisualTemplateListSort;
};

function resolveVisualTemplateListOrderBy(
  sort: PartMeasurementVisualTemplateListSort | undefined
): Prisma.PartMeasurementVisualTemplateOrderByWithRelationInput[] {
  if (sort === 'recentlyUpdated') {
    return [{ updatedAt: 'desc' }, { name: 'asc' }];
  }
  return [{ name: 'asc' }, { createdAt: 'desc' }];
}

/** visual template の一覧・作成（図面は別ストレージに保存し DB には相対 URL のみ） */
export class PartMeasurementVisualTemplateService {
  async list(params: PartMeasurementVisualTemplateListParams = {}) {
    const q = params.q?.trim();
    const where: Prisma.PartMeasurementVisualTemplateWhereInput = {};
    if (!params.includeInactive) {
      where.isActive = true;
    }
    if (q && q.length > 0) {
      where.name = { contains: q, mode: 'insensitive' };
    }

    const take =
      params.limit !== undefined
        ? Math.min(Math.max(params.limit, 1), VISUAL_TEMPLATE_LIST_MAX_LIMIT)
        : undefined;

    return prisma.partMeasurementVisualTemplate.findMany({
      where,
      orderBy: resolveVisualTemplateListOrderBy(params.sort),
      ...(take !== undefined ? { take } : {})
    });
  }

  async getById(id: string, options: { includeInactive?: boolean } = {}) {
    const visual = await prisma.partMeasurementVisualTemplate.findUnique({
      where: { id }
    });
    if (!visual) return null;
    if (!options.includeInactive && !visual.isActive) return null;
    return visual;
  }

  async create(params: { name: string; drawingImageRelativePath: string }) {
    const name = params.name.trim();
    if (name.length === 0) {
      throw new ApiError(400, 'visual template 名が空です');
    }
    const path = params.drawingImageRelativePath.trim();
    if (!path.startsWith('/api/storage/part-measurement-drawings/')) {
      throw new ApiError(400, '図面の保存パスが不正です');
    }
    return prisma.partMeasurementVisualTemplate.create({
      data: {
        name,
        drawingImageRelativePath: path,
        isActive: true
      }
    });
  }

  /**
   * テンプレ作成失敗などで未参照になった visual template を回収する。
   * 参照確認と削除を同一トランザクション + 行ロックで直列化する。
   */
  async deleteIfUnused(visualTemplateId: string): Promise<'deleted' | 'not_found' | 'in_use'> {
    let drawingPath: string | null = null;
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "PartMeasurementVisualTemplate"
        WHERE id = ${visualTemplateId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        return 'not_found' as const;
      }

      const visual = await tx.partMeasurementVisualTemplate.findUnique({
        where: { id: visualTemplateId },
        select: { drawingImageRelativePath: true }
      });
      if (!visual) {
        return 'not_found' as const;
      }

      const referenceCount = await tx.partMeasurementTemplate.count({
        where: { visualTemplateId }
      });
      if (referenceCount > 0) {
        return 'in_use' as const;
      }

      await tx.partMeasurementVisualTemplate.delete({ where: { id: visualTemplateId } });
      drawingPath = visual.drawingImageRelativePath;
      return 'deleted' as const;
    });

    if (outcome === 'deleted' && drawingPath) {
      try {
        await PartMeasurementDrawingStorage.deleteDrawing(drawingPath);
      } catch (err) {
        logger.warn(
          { err, visualTemplateId, drawingPath },
          'part_measurement_visual_template_drawing_delete_failed'
        );
      }
    }
    return outcome;
  }
}
