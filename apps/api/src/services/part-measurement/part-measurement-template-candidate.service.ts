import type { PartMeasurementProcessGroup } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PART_MEASUREMENT_LEGACY_RESOURCE_CD } from './part-measurement-constants.js';
import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';
import {
  classifyCandidateMatch,
  compareCandidates,
  isSelectableForSheetCreation,
  matchesSearchFilter,
  normalizeFhincd,
  normalizeFhinmeiForMatch,
  type PartMeasurementTemplateMatchKind
} from './template-candidate-rules.js';

export type ListTemplateCandidatesInput = {
  fhincd: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  /** 日程の品名（FHINMEI_ONLY 照合） */
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
    const scheduleProcessGroup = input.processGroup;
    const scheduleFhinmeiNorm = normalizeFhinmeiForMatch(input.fhinmei);

    const [threeKeyRows, twoKeyScopeRows, fhinmeiRows] = await Promise.all([
      prisma.partMeasurementTemplate.findMany({
        where: {
          isActive: true,
          templateScope: 'THREE_KEY',
          fhincd: { equals: fhincdDb, mode: 'insensitive' }
        },
        include: partMeasurementTemplateFullInclude
      }),
      prisma.partMeasurementTemplate.findMany({
        where: {
          isActive: true,
          templateScope: 'FHINCD_RESOURCE',
          fhincd: { equals: fhincdDb, mode: 'insensitive' },
          resourceCd: scheduleResourceNorm
        },
        include: partMeasurementTemplateFullInclude
      }),
      scheduleFhinmeiNorm.length > 0
        ? prisma.partMeasurementTemplate.findMany({
            where: {
              isActive: true,
              templateScope: 'FHINMEI_ONLY'
            },
            include: partMeasurementTemplateFullInclude
          })
        : Promise.resolve([])
    ]);

    const byId = new Map<string, (typeof threeKeyRows)[0]>();
    for (const t of threeKeyRows) {
      byId.set(t.id, t);
    }
    for (const t of twoKeyScopeRows) {
      if (!byId.has(t.id)) {
        byId.set(t.id, t);
      }
    }
    for (const t of fhinmeiRows) {
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
      const matchKind = classifyCandidateMatch({
        scheduleFhincdNorm: fhincdNorm,
        scheduleProcessGroup,
        scheduleResourceCdNorm: scheduleResourceNorm,
        scheduleFhinmei: input.fhinmei,
        templateScope: template.templateScope,
        templateFhincdNorm,
        templateProcessGroup: template.processGroup,
        templateResourceCdNorm: templateResourceNorm,
        candidateFhinmei: template.candidateFhinmei
      });
      if (!matchKind) {
        continue;
      }
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
        {
          matchKind: a.matchKind,
          version: a.template.version,
          updatedAtMs: a.template.updatedAt.getTime(),
          fhinmeiNormalizedLen:
            a.matchKind === 'one_key_fhinmei'
              ? normalizeFhinmeiForMatch(a.template.candidateFhinmei).length
              : undefined
        },
        {
          matchKind: b.matchKind,
          version: b.template.version,
          updatedAtMs: b.template.updatedAt.getTime(),
          fhinmeiNormalizedLen:
            b.matchKind === 'one_key_fhinmei'
              ? normalizeFhinmeiForMatch(b.template.candidateFhinmei).length
              : undefined
        }
      )
    );

    return rows;
  }
}
