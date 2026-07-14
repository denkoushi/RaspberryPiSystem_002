import type { PartMeasurementTemplateItem, SelfInspectionMode } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

import {
  listRequiredEntrySlots,
  type SelfInspectionTemplateConfig
} from './self-inspection-config.js';

export const SELF_INSPECTION_PAPER_RECORD_POINTS_PER_PAGE = 14;
export const SELF_INSPECTION_PAPER_RECORD_ENTRIES_PER_PAGE = 5;

export type SelfInspectionPaperReportPagePlan = {
  pageNumber: number;
  entryIndexFrom: number | null;
  entryIndexTo: number | null;
  markerNoFrom: number | null;
  markerNoTo: number | null;
};

type TemplateForPaperReport = {
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: number | null;
  selfInspectionSampleSize?: number | null;
  items: Array<
    Pick<
      PartMeasurementTemplateItem,
      | 'id'
      | 'sortOrder'
      | 'displayMarker'
      | 'markerXRatio'
      | 'markerYRatio'
      | 'lowerLimit'
      | 'upperLimit'
      | 'valueKind'
    >
  >;
  visualTemplate?: { drawingImageRelativePath: string } | null;
};

export function assertTemplateSupportsSelfInspectionPaperReport(
  template: TemplateForPaperReport
): void {
  if (!template.visualTemplate?.drawingImageRelativePath?.trim()) {
    throw new ApiError(409, '印刷用の検査図面が設定されていません');
  }
  if (template.items.length === 0) {
    throw new ApiError(409, '測定点がないため紙帳票を発行できません');
  }
  const unsupported = template.items.some(
    (item) =>
      item.valueKind === 'JUDGEMENT' ||
      item.markerXRatio == null ||
      item.markerYRatio == null ||
      item.lowerLimit == null ||
      item.upperLimit == null
  );
  if (unsupported) {
    throw new ApiError(409, 'OK/NG判定を含むテンプレートは紙帳票を発行できません');
  }
}

export function buildSelfInspectionPaperReportPagePlans(
  template: TemplateForPaperReport,
  plannedQuantity: number
): SelfInspectionPaperReportPagePlan[] {
  assertTemplateSupportsSelfInspectionPaperReport(template);

  const entrySlots = listRequiredEntrySlots(templateConfigFromTemplate(template), plannedQuantity);
  if (entrySlots.length === 0) {
    throw new ApiError(409, '自主検査の必要件数を解決できません');
  }

  const points = template.items
    .map((item) => ({
      id: item.id,
      markerNo: resolveMarkerNo(item.displayMarker, item.sortOrder)
    }))
    .sort((a, b) => a.markerNo - b.markerNo || a.id.localeCompare(b.id));

  const pointPages = chunk(points, SELF_INSPECTION_PAPER_RECORD_POINTS_PER_PAGE);
  const entryPages = chunk(entrySlots, SELF_INSPECTION_PAPER_RECORD_ENTRIES_PER_PAGE);
  const pages: SelfInspectionPaperReportPagePlan[] = [];

  for (const entryPage of entryPages) {
    for (const pointPage of pointPages) {
      const entryNumbers = entryPage.map((entry) => entry.entryIndex);
      const markerNumbers = pointPage.map((point) => point.markerNo);
      pages.push({
        pageNumber: pages.length + 2,
        entryIndexFrom: minOrNull(entryNumbers),
        entryIndexTo: maxOrNull(entryNumbers),
        markerNoFrom: minOrNull(markerNumbers),
        markerNoTo: maxOrNull(markerNumbers)
      });
    }
  }

  return pages;
}

function templateConfigFromTemplate(template: TemplateForPaperReport): SelfInspectionTemplateConfig {
  return {
    selfInspectionMode: template.selfInspectionMode,
    selfInspectionFixedCount: template.selfInspectionFixedCount,
    selfInspectionSampleSize: template.selfInspectionSampleSize ?? null
  };
}

function resolveMarkerNo(displayMarker: string | null, sortOrder: number): number {
  const marker = (displayMarker ?? '').trim();
  if (/^\d+$/.test(marker)) {
    const parsed = Number(marker);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return sortOrder + 1;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function minOrNull(values: number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null;
}

function maxOrNull(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}
