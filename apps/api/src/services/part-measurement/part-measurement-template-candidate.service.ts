import type { PartMeasurementProcessGroup } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PART_MEASUREMENT_LEGACY_RESOURCE_CD } from './part-measurement-constants.js';
import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';
import {
  classifyTemplateMatch,
  compareCandidates,
  isSelectableForSheetCreation,
  matchesSearchFilter,
  normalizeFhincd,
  type PartMeasurementTemplateMatchKind,
  tokenForFhinmeiSimilarSearch
} from './template-candidate-rules.js';

export type ListTemplateCandidatesInput = {
  fhincd: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  /** 日程の品名（類似候補検索のヒント） */
  fhinmei?: string | null;
  /** 一覧のテキスト絞り込み */
  q?: string | null;
};

export type TemplateCandidateRow = {
  matchKind: PartMeasurementTemplateMatchKind;
  selectable: boolean;
  itemCount: number;
  template: import('@prisma/client').PartMeasurementTemplate & {
    items: import('@prisma/client').PartMeasurementTemplateItem[];
    visualTemplate: import('@prisma/client').PartMeasurementVisualTemplate | null;
  };
};

function normalizeResourceCd(raw: string): string {
  const t = raw.trim();
  return t.length > 0 ? t : PART_MEASUREMENT_LEGACY_RESOURCE_CD;
}

export class PartMeasurementTemplateCandidateService {
  async listCandidates(input: ListTemplateCandidatesInput): Promise<TemplateCandidateRow[]> {
    const fhincdNorm = normalizeFhincd(input.fhincd);
    if (fhincdNorm.length === 0) {
      return [];
    }
    const scheduleResourceNorm = normalizeResourceCd(input.resourceCd);
    const fhincdDb = input.fhincd.trim();

    const bySameFhincd = await prisma.partMeasurementTemplate.findMany({
      where: {
        isActive: true,
        processGroup: input.processGroup,
        fhincd: { equals: fhincdDb, mode: 'insensitive' }
      },
      include: partMeasurementTemplateFullInclude
    });

    const token = tokenForFhinmeiSimilarSearch(input.fhinmei ?? undefined);
    let byNameAcrossFhincd: typeof bySameFhincd = [];
    if (token) {
      byNameAcrossFhincd = await prisma.partMeasurementTemplate.findMany({
        where: {
          isActive: true,
          processGroup: input.processGroup,
          NOT: { fhincd: { equals: fhincdDb, mode: 'insensitive' } },
          name: { contains: token, mode: 'insensitive' }
        },
        include: partMeasurementTemplateFullInclude,
        take: 40,
        orderBy: [{ fhincd: 'asc' }, { resourceCd: 'asc' }, { version: 'desc' }]
      });
    }

    const byId = new Map<string, (typeof bySameFhincd)[0]>();
    for (const t of bySameFhincd) {
      byId.set(t.id, t);
    }
    for (const t of byNameAcrossFhincd) {
      if (!byId.has(t.id)) {
        byId.set(t.id, t);
      }
    }

    const q = input.q?.trim() ?? '';
    const rows: TemplateCandidateRow[] = [];

    for (const template of byId.values()) {
      if (!matchesSearchFilter(q.length > 0 ? q : undefined, template)) {
        continue;
      }
      const templateFhincdNorm = normalizeFhincd(template.fhincd);
      const templateResourceNorm = normalizeResourceCd(template.resourceCd);
      const matchKind = classifyTemplateMatch({
        scheduleFhincdNorm: fhincdNorm,
        scheduleResourceCdNorm: scheduleResourceNorm,
        templateFhincdNorm,
        templateResourceCdNorm: templateResourceNorm
      });
      const selectable = isSelectableForSheetCreation(matchKind);
      rows.push({
        matchKind,
        selectable,
        itemCount: template.items?.length ?? 0,
        template
      });
    }

    rows.sort((a, b) =>
      compareCandidates(
        { matchKind: a.matchKind, version: a.template.version },
        { matchKind: b.matchKind, version: b.template.version }
      )
    );

    return rows;
  }
}
