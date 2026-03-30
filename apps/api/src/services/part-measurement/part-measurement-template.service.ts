import type { PartMeasurementProcessGroup, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { PART_MEASUREMENT_LEGACY_RESOURCE_CD } from './part-measurement-constants.js';
import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';

export type TemplateItemInput = {
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  /** 図面上の番号など表示用（任意） */
  displayMarker?: string | null;
  unit?: string | null;
  allowNegative?: boolean;
  decimalPlaces?: number;
};

function normalizeResourceCd(raw: string): string {
  const t = raw.trim();
  return t.length > 0 ? t : PART_MEASUREMENT_LEGACY_RESOURCE_CD;
}

export class PartMeasurementTemplateService {
  async findActiveByFhincdGroupAndResource(
    fhincd: string,
    processGroup: PartMeasurementProcessGroup,
    resourceCd: string
  ) {
    const f = fhincd.trim();
    const r = normalizeResourceCd(resourceCd);
    if (f.length === 0) return null;
    return prisma.partMeasurementTemplate.findFirst({
      where: { fhincd: f, processGroup, resourceCd: r, isActive: true },
      orderBy: { version: 'desc' },
      include: partMeasurementTemplateFullInclude
    });
  }

  async listTemplates(query: {
    fhincd?: string;
    processGroup?: PartMeasurementProcessGroup;
    resourceCd?: string;
    includeInactive?: boolean;
  }) {
    const where: Prisma.PartMeasurementTemplateWhereInput = {};
    if (query.fhincd?.trim()) {
      where.fhincd = query.fhincd.trim();
    }
    if (query.processGroup) {
      where.processGroup = query.processGroup;
    }
    if (query.resourceCd !== undefined) {
      where.resourceCd = normalizeResourceCd(query.resourceCd);
    }
    if (!query.includeInactive) {
      where.isActive = true;
    }
    return prisma.partMeasurementTemplate.findMany({
      where,
      orderBy: [{ fhincd: 'asc' }, { processGroup: 'asc' }, { resourceCd: 'asc' }, { version: 'desc' }],
      include: partMeasurementTemplateFullInclude
    });
  }

  /**
   * 同一 FIHNCD + 工程 + 資源CD で新バージョンを作成し、同キーの旧版を非アクティブ化する。
   */
  async createTemplateVersion(params: {
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    name: string;
    items: TemplateItemInput[];
    visualTemplateId?: string | null;
  }) {
    const fhincd = params.fhincd.trim();
    const resourceCd = normalizeResourceCd(params.resourceCd);
    if (fhincd.length === 0) {
      throw new ApiError(400, 'FIHNCD が空です');
    }
    if (params.items.length === 0) {
      throw new ApiError(400, 'テンプレート項目が空です');
    }

    const visualId = params.visualTemplateId?.trim() || null;

    return prisma.$transaction(async (tx) => {
      if (visualId) {
        const vt = await tx.partMeasurementVisualTemplate.findFirst({
          where: { id: visualId, isActive: true }
        });
        if (!vt) {
          throw new ApiError(400, 'visual template が見つからないか無効です');
        }
      }

      const agg = await tx.partMeasurementTemplate.aggregate({
        where: { fhincd, processGroup: params.processGroup, resourceCd },
        _max: { version: true }
      });
      const nextVersion = (agg._max.version ?? 0) + 1;

      await tx.partMeasurementTemplate.updateMany({
        where: { fhincd, processGroup: params.processGroup, resourceCd },
        data: { isActive: false }
      });

      const template = await tx.partMeasurementTemplate.create({
        data: {
          fhincd,
          processGroup: params.processGroup,
          resourceCd,
          name: params.name.trim(),
          version: nextVersion,
          isActive: true,
          visualTemplateId: visualId,
          items: {
            create: params.items.map((item) => {
              const dp = item.decimalPlaces ?? 6;
              const clamped = Math.min(6, Math.max(0, Math.floor(dp)));
              const dm = item.displayMarker?.trim();
              return {
                sortOrder: item.sortOrder,
                datumSurface: item.datumSurface.trim(),
                measurementPoint: item.measurementPoint.trim(),
                measurementLabel: item.measurementLabel.trim(),
                displayMarker: dm && dm.length > 0 ? dm.slice(0, 40) : null,
                unit: item.unit?.trim() || null,
                allowNegative: item.allowNegative !== false,
                decimalPlaces: clamped
              };
            })
          }
        },
        include: partMeasurementTemplateFullInclude
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
        where: { fhincd: t.fhincd, processGroup: t.processGroup, resourceCd: t.resourceCd },
        data: { isActive: false }
      }),
      prisma.partMeasurementTemplate.update({
        where: { id: templateId },
        data: { isActive: true }
      })
    ]);
    return prisma.partMeasurementTemplate.findUniqueOrThrow({
      where: { id: templateId },
      include: partMeasurementTemplateFullInclude
    });
  }
}
