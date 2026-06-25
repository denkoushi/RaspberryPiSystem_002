import {
  INSPECTION_DRAWING_PRINT_FILL_EMPTY_RECORD_SLOTS,
  INSPECTION_DRAWING_PRINT_MAX_ENTRY_COUNT,
  INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE,
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

export type InspectionDrawingPrintRecordEntrySlot = {
  entryIndex: number;
  entryLabel: string;
};

export type InspectionDrawingPrintRecordPage = {
  pageNumber: number;
  pageLabel: string;
  qrPayload?: string;
  slots: InspectionDrawingPrintRecordSlot[];
  entrySlots: InspectionDrawingPrintRecordEntrySlot[];
};

export type InspectionDrawingPrintMetadata = {
  previewIdentifier: string;
  paperReportId: string | null;
  issuedAtDisplay: string;
  fhincd: string;
  resourceCd: string;
  resourceName: string;
  templateName: string;
  processLabel: string;
  templateId: string;
  templateVersion: number;
  reportUnitKey: string;
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
  /** 順位ボード行の予定数。全数検査の記録欄数に使う。 */
  plannedQuantity?: number | null;
  paperReport?: {
    reportId: string;
    pages: Array<{
      pageNumber: number;
      qrPayload: string;
    }>;
  } | null;
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

export function buildInspectionDrawingPrintRecordPageQrPayload(input: {
  metadata: InspectionDrawingPrintMetadata;
  page: InspectionDrawingPrintRecordPage;
  totalPages: number;
}): string {
  const entryNumbers = input.page.entrySlots.map((slot) => slot.entryIndex + 1);
  const entryIndexFrom = entryNumbers.length > 0 ? Math.min(...entryNumbers) : null;
  const entryIndexTo = entryNumbers.length > 0 ? Math.max(...entryNumbers) : null;
  const markerNumbers = input.page.slots
    .filter(
      (slot): slot is Extract<InspectionDrawingPrintRecordSlot, { kind: 'point' }> =>
        slot.kind === 'point'
    )
    .map((slot) => slot.point.markerNo);
  const markerNoFrom = markerNumbers.length > 0 ? Math.min(...markerNumbers) : null;
  const markerNoTo = markerNumbers.length > 0 ? Math.max(...markerNumbers) : null;

  return JSON.stringify({
    type: 'inspection-drawing-record-page',
    schemaVersion: 1,
    reportId: input.metadata.previewIdentifier,
    templateId: input.metadata.templateId,
    fhincd: input.metadata.fhincd,
    resourceCd: input.metadata.resourceCd,
    templateVersion: input.metadata.templateVersion,
    pageNumber: input.page.pageNumber,
    totalPages: input.totalPages,
    entryIndexFrom,
    entryIndexTo,
    markerNoFrom,
    markerNoTo
  });
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
  const { template, resourceName, issuedAt, plannedQuantity } = input;
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

  const previewIdentifier =
    input.paperReport?.reportId ??
    buildInspectionDrawingPrintPreviewIdentifier(template.id, template.version, issuedAt);

  const metadata: InspectionDrawingPrintMetadata = {
    previewIdentifier,
    paperReportId: input.paperReport?.reportId ?? null,
    issuedAtDisplay: formatInspectionDrawingPrintIssuedAtDisplay(issuedAt),
    fhincd: template.fhincd,
    resourceCd: template.resourceCd,
    resourceName,
    templateName: template.name,
    processLabel: processGroupLabel(template.processGroup),
    templateId: template.id,
    templateVersion: template.version,
    reportUnitKey: buildInspectionDrawingPrintReportUnitKey(template)
  };

  const pageQrPayloadByNumber = new Map(
    (input.paperReport?.pages ?? []).map((page) => [page.pageNumber, page.qrPayload])
  );
  const recordPages = buildRecordPages(
    points,
    buildInspectionDrawingPrintRecordEntrySlots(template, plannedQuantity)
  );
  const totalPages = 1 + recordPages.length;

  return {
    metadata,
    points,
    recordPages: recordPages.map((page, index) => ({
      ...page,
      pageLabel: `${index + 2}/${totalPages}`,
      qrPayload: pageQrPayloadByNumber.get(page.pageNumber)
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

export function buildInspectionDrawingPrintReportUnitKey(
  template: Pick<PartMeasurementTemplateDto, 'fhincd' | 'resourceCd'>
): string {
  return `${template.fhincd.trim()} / ${template.resourceCd.trim()}`;
}

export function buildInspectionDrawingPrintRecordEntrySlots(
  template: Pick<
    PartMeasurementTemplateDto,
    'selfInspectionMode' | 'selfInspectionFixedCount' | 'selfInspectionSampleSize'
  >,
  plannedQuantity?: number | null
): InspectionDrawingPrintRecordEntrySlot[] {
  const mode = normalizeInspectionDrawingPrintSelfInspectionMode(template.selfInspectionMode);

  if (mode === 'single') {
    return [{ entryIndex: 0, entryLabel: '1件目' }];
  }

  if (mode === 'first_last') {
    return [
      { entryIndex: 0, entryLabel: '最初' },
      { entryIndex: 1, entryLabel: '最終' }
    ];
  }

  const rawCount =
    mode === 'fixed_count'
      ? template.selfInspectionFixedCount ?? template.selfInspectionSampleSize
      : normalizeInspectionDrawingPrintEntryCount(plannedQuantity) ??
        INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE;
  const count = Math.max(1, Math.floor(rawCount ?? 1));

  return Array.from({ length: count }, (_, index) => ({
    entryIndex: index,
    entryLabel: `${index + 1}件目`
  }));
}

function normalizeInspectionDrawingPrintSelfInspectionMode(
  mode: PartMeasurementTemplateDto['selfInspectionMode'] | string | null | undefined
): PartMeasurementTemplateDto['selfInspectionMode'] {
  const normalized = String(mode ?? 'full').trim().toLowerCase();
  if (normalized === 'single') return 'single';
  if (normalized === 'first_last') return 'first_last';
  if (normalized === 'fixed_count' || normalized === 'sample') return 'fixed_count';
  return 'full';
}

function normalizeInspectionDrawingPrintEntryCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const count = Math.floor(value);
  if (count <= 0) return null;
  return Math.min(count, INSPECTION_DRAWING_PRINT_MAX_ENTRY_COUNT);
}

export function buildRecordPages(
  points: InspectionDrawingPoint[],
  entrySlots: InspectionDrawingPrintRecordEntrySlot[] = [{ entryIndex: 0, entryLabel: '1件目' }]
): InspectionDrawingPrintRecordPage[] {
  const perPage = INSPECTION_DRAWING_PRINT_RECORD_POINTS_PER_PAGE;
  const entriesPerPage = INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE;
  const normalizedEntrySlots =
    entrySlots.length > 0 ? entrySlots : [{ entryIndex: 0, entryLabel: '1件目' }];
  const pointPageCount = Math.ceil(points.length / perPage);
  const entryPageCount = Math.ceil(normalizedEntrySlots.length / entriesPerPage);
  const pages: InspectionDrawingPrintRecordPage[] = [];

  for (let entryPageIndex = 0; entryPageIndex < entryPageCount; entryPageIndex += 1) {
    const entrySlice = normalizedEntrySlots.slice(
      entryPageIndex * entriesPerPage,
      entryPageIndex * entriesPerPage + entriesPerPage
    );

    for (let pointPageIndex = 0; pointPageIndex < pointPageCount; pointPageIndex += 1) {
      const pointSlice = points.slice(pointPageIndex * perPage, pointPageIndex * perPage + perPage);
      const slots: InspectionDrawingPrintRecordSlot[] = pointSlice.map((point) => ({
        kind: 'point',
        point
      }));

      if (INSPECTION_DRAWING_PRINT_FILL_EMPTY_RECORD_SLOTS) {
        while (slots.length < perPage) {
          slots.push({ kind: 'empty' });
        }
      }

      pages.push({
        pageNumber: pages.length + 2,
        pageLabel: '',
        slots,
        entrySlots: entrySlice
      });
    }
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
