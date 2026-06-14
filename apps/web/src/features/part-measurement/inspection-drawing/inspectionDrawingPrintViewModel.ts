import {
  INSPECTION_DRAWING_PRINT_FILL_EMPTY_RECORD_SLOTS,
  INSPECTION_DRAWING_PRINT_RECORD_POINTS_PER_PAGE,
  INSPECTION_DRAWING_PRINT_TIME_ZONE
} from './inspectionDrawingPrintConstants';
import { isLegacyAbsoluteOnlyPoint } from './markerNumbering';
import { templateItemToDrawingPoint, templateSupportsInspectionDrawing } from './templateItemMappers';

import type { PartMeasurementProcessGroup, PartMeasurementTemplateDto } from '../types';
import type { InspectionDrawingPoint } from './types';

export type InspectionDrawingPrintRecordSlot =
  | { kind: 'point'; point: InspectionDrawingPoint }
  | { kind: 'empty' };

export type InspectionDrawingPrintRecordPage = {
  pageNumber: number;
  pageLabel: string;
  slots: InspectionDrawingPrintRecordSlot[];
};

export type InspectionDrawingPrintMetadata = {
  /** Not a formal DB form ID — preview-only identifier for print/OCR planning. */
  previewIdentifier: string;
  issuedAtDisplay: string;
  fhincd: string;
  resourceCd: string;
  resourceName: string;
  templateName: string;
  processLabel: string;
  templateId: string;
  templateVersion: number;
};

export type InspectionDrawingPrintViewModel = {
  metadata: InspectionDrawingPrintMetadata;
  points: InspectionDrawingPoint[];
  recordPages: InspectionDrawingPrintRecordPage[];
  totalPages: number;
  qrPayloadSummary: string;
};

export type BuildInspectionDrawingPrintViewModelInput = {
  template: PartMeasurementTemplateDto;
  resourceName: string;
  issuedAt: Date;
};

export class InspectionDrawingPrintBuildError extends Error {
  readonly code: 'unsupported_template' | 'no_measurement_points';

  constructor(code: 'unsupported_template' | 'no_measurement_points', message: string) {
    super(message);
    this.name = 'InspectionDrawingPrintBuildError';
    this.code = code;
  }
}

export function formatInspectionDrawingPrintIssuedAtDisplay(issuedAt: Date): string {
  return formatInTimeZone(issuedAt, INSPECTION_DRAWING_PRINT_TIME_ZONE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(/\//g, '-');
}

export function formatInspectionDrawingPrintIdentifierTimestamp(issuedAt: Date): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: INSPECTION_DRAWING_PRINT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(issuedAt);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}

export function buildInspectionDrawingPrintPreviewIdentifier(
  templateId: string,
  version: number,
  issuedAt: Date
): string {
  const shortId = templateId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `PRINT-${shortId}-v${version}-${formatInspectionDrawingPrintIdentifierTimestamp(issuedAt)}`;
}

export function buildInspectionDrawingPrintQrPayloadSummary(input: {
  previewIdentifier: string;
  templateId: string;
  fhincd: string;
  resourceCd: string;
}): string {
  return `${input.previewIdentifier}\n${input.templateId}\n${input.fhincd}\n${input.resourceCd}`;
}

export function formatInspectionDrawingPrintTolerance(point: InspectionDrawingPoint): string {
  if (isLegacyAbsoluteOnlyPoint(point) && point.legacyAbsoluteBounds) {
    const { lowerLimit, upperLimit } = point.legacyAbsoluteBounds;
    return `合格範囲 ${lowerLimit} - ${upperLimit}`;
  }

  const nominal = point.nominalRaw.trim();
  const lower = point.lowerToleranceRaw.trim();
  const upper = point.upperToleranceRaw.trim();
  if (!nominal && !lower && !upper) return '-';
  return `${nominal || '-'} / ${lower || '-'} - ${upper || '-'}`;
}

export function buildInspectionDrawingPrintViewModel(
  input: BuildInspectionDrawingPrintViewModelInput
): InspectionDrawingPrintViewModel {
  const { template, resourceName, issuedAt } = input;
  const drawingPath = template.visualTemplate?.drawingImageRelativePath ?? null;

  if (!templateSupportsInspectionDrawing(template.items, drawingPath)) {
    throw new InspectionDrawingPrintBuildError(
      'unsupported_template',
      '図面付きで全測定点に座標と上下限があるテンプレートのみ印刷できます。'
    );
  }

  const points = template.items
    .map((item) => templateItemToDrawingPoint(item))
    .sort((a, b) => a.markerNo - b.markerNo || a.id.localeCompare(b.id));

  if (points.length === 0) {
    throw new InspectionDrawingPrintBuildError(
      'no_measurement_points',
      '測定点がないため帳票を生成できません。'
    );
  }

  const previewIdentifier = buildInspectionDrawingPrintPreviewIdentifier(
    template.id,
    template.version,
    issuedAt
  );

  const metadata: InspectionDrawingPrintMetadata = {
    previewIdentifier,
    issuedAtDisplay: formatInspectionDrawingPrintIssuedAtDisplay(issuedAt),
    fhincd: template.fhincd,
    resourceCd: template.resourceCd,
    resourceName,
    templateName: template.name,
    processLabel: processGroupLabel(template.processGroup),
    templateId: template.id,
    templateVersion: template.version
  };

  const recordPages = buildRecordPages(points);
  const totalPages = 1 + recordPages.length;

  return {
    metadata,
    points,
    recordPages: recordPages.map((page, index) => ({
      ...page,
      pageLabel: `${index + 2}/${totalPages}`
    })),
    totalPages,
    qrPayloadSummary: buildInspectionDrawingPrintQrPayloadSummary({
      previewIdentifier,
      templateId: template.id,
      fhincd: template.fhincd,
      resourceCd: template.resourceCd
    })
  };
}

export function buildRecordPages(points: InspectionDrawingPoint[]): InspectionDrawingPrintRecordPage[] {
  const perPage = INSPECTION_DRAWING_PRINT_RECORD_POINTS_PER_PAGE;
  const pageCount = Math.ceil(points.length / perPage);
  const pages: InspectionDrawingPrintRecordPage[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const slice = points.slice(pageIndex * perPage, pageIndex * perPage + perPage);
    const slots: InspectionDrawingPrintRecordSlot[] = slice.map((point) => ({
      kind: 'point',
      point
    }));

    if (INSPECTION_DRAWING_PRINT_FILL_EMPTY_RECORD_SLOTS) {
      while (slots.length < perPage) {
        slots.push({ kind: 'empty' });
      }
    }

    pages.push({
      pageNumber: pageIndex + 2,
      pageLabel: '',
      slots
    });
  }

  return pages;
}

function processGroupLabel(processGroup: PartMeasurementProcessGroup | null): string {
  if (processGroup === 'cutting') return '切削';
  if (processGroup === 'grinding') return '研削';
  return '—';
}

function formatInTimeZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat('ja-JP', { ...options, timeZone }).format(date);
}
