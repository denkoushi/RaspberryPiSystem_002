import type { PartMeasurementProcessGroup, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export type TemplateItemInput = {
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  unit?: string | null;
  allowNegative?: boolean;
};

export class PartMeasurementTemplateService {
  async findActiveByFhincdAndGroup(fhincd: string, processGroup: PartMeasurementProcessGroup) {
    const f = fhincd.trim();
    if (f.length === 0) return null;
    return prisma.partMeasurementTemplate.findFirst({
      where: { fhincd: f, processGroup, isActive: true },
      orderBy: { version: 'desc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } }
    });
  }

  async listTemplates(query: { fhincd?: string; processGroup?: PartMeasurementProcessGroup; includeInactive?: boolean }) {
    const where: Prisma.PartMeasurementTemplateWhereInput = {};
    if (query.fhincd?.trim()) {
      where.fhincd = query.fhincd.trim();
    }
    if (query.processGroup) {
      where.processGroup = query.processGroup;
    }
    if (!query.includeInactive) {
      where.isActive = true;
    }
    return prisma.partMeasurementTemplate.findMany({
      where,
      orderBy: [{ fhincd: 'asc' }, { processGroup: 'asc' }, { version: 'desc' }],
      include: { items: { orderBy: { sortOrder: 'asc' } } }
    });
  }

  /**
   * 同一 FIHNCD + 工程グループで新バージョンを作成し、旧版を非アクティブ化する。
   */
  async createTemplateVersion(params: {
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    name: string;
    items: TemplateItemInput[];
  }) {
    const fhincd = params.fhincd.trim();
    if (fhincd.length === 0) {
      throw new ApiError(400, 'FIHNCD が空です');
    }
    if (params.items.length === 0) {
      throw new ApiError(400, 'テンプレート項目が空です');
    }

    return prisma.$transaction(async (tx) => {
      const agg = await tx.partMeasurementTemplate.aggregate({
        where: { fhincd, processGroup: params.processGroup },
        _max: { version: true }
      });
      const nextVersion = (agg._max.version ?? 0) + 1;

      await tx.partMeasurementTemplate.updateMany({
        where: { fhincd, processGroup: params.processGroup },
        data: { isActive: false }
      });

      const template = await tx.partMeasurementTemplate.create({
        data: {
          fhincd,
          processGroup: params.processGroup,
          name: params.name.trim(),
          version: nextVersion,
          isActive: true,
          items: {
            create: params.items.map((item) => ({
              sortOrder: item.sortOrder,
              datumSurface: item.datumSurface.trim(),
              measurementPoint: item.measurementPoint.trim(),
              measurementLabel: item.measurementLabel.trim(),
              unit: item.unit?.trim() || null,
              allowNegative: item.allowNegative !== false
            }))
          }
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } }
      });

      return template;
    });
  }

  async setActiveVersion(templateId: string) {
    const t = await prisma.partMeasurementTemplate.findUnique({ where: { id: templateId } });
    if (!t) {
      throw new ApiError(404, 'テンプレートが見つかりません');
    }
    await prisma.$transaction([
      prisma.partMeasurementTemplate.updateMany({
        where: { fhincd: t.fhincd, processGroup: t.processGroup },
        data: { isActive: false }
      }),
      prisma.partMeasurementTemplate.update({
        where: { id: templateId },
        data: { isActive: true }
      })
    ]);
    return prisma.partMeasurementTemplate.findUniqueOrThrow({
      where: { id: templateId },
      include: { items: { orderBy: { sortOrder: 'asc' } } }
    });
  }
}
