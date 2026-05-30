import type { Prisma } from '@prisma/client';

import { isInspectionDrawingEvaluationTemplate } from './part-measurement-template-guards.js';

/** 図面中心UIへ送る数量（本番・評価共通） */
export const INSPECTION_DRAWING_UI_QUANTITY = 1;

type TemplateItemMarkerFields = {
  markerXRatio: Prisma.Decimal | string | number | null;
  markerYRatio: Prisma.Decimal | string | number | null;
  lowerLimit: Prisma.Decimal | string | number | null;
  upperLimit: Prisma.Decimal | string | number | null;
};

type TemplateForDrawingSupport = {
  items: TemplateItemMarkerFields[];
  visualTemplate: { drawingImageRelativePath: string } | null;
};

function parseMarkerRatio(raw: Prisma.Decimal | string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'object' && raw !== null && 'toNumber' in raw ? raw.toNumber() : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function templateItemSupportsInspectionDrawing(item: TemplateItemMarkerFields): boolean {
  return (
    parseMarkerRatio(item.markerXRatio) != null &&
    parseMarkerRatio(item.markerYRatio) != null &&
    parseMarkerRatio(item.lowerLimit) != null &&
    parseMarkerRatio(item.upperLimit) != null
  );
}

/** テンプレ全体が図面中心UI対象か（図面パスあり・全項目に座標と上下限） */
export function templateSupportsInspectionDrawing(template: TemplateForDrawingSupport): boolean {
  const drawingPath = template.visualTemplate?.drawingImageRelativePath?.trim();
  if (!drawingPath || template.items.length === 0) return false;
  return template.items.every(templateItemSupportsInspectionDrawing);
}

export function sheetQuantityForInspectionDrawing(sheet: { quantity: number | null }): number {
  return sheet.quantity ?? 1;
}

export function sheetUsesProductionInspectionDrawingUi(sheet: {
  quantity: number | null;
  template: TemplateForDrawingSupport & { fhincd: string } | null;
}): boolean {
  if (!sheet.template || isInspectionDrawingEvaluationTemplate(sheet.template)) {
    return false;
  }
  if (sheet.quantity !== INSPECTION_DRAWING_UI_QUANTITY) {
    return false;
  }
  return templateSupportsInspectionDrawing(sheet.template);
}

export function sheetUsesInspectionDrawingEvaluationUi(sheet: {
  quantity: number | null;
  template: { fhincd: string } | null;
}): boolean {
  if (!sheet.template || !isInspectionDrawingEvaluationTemplate(sheet.template)) {
    return false;
  }
  return sheetQuantityForInspectionDrawing(sheet) === INSPECTION_DRAWING_UI_QUANTITY;
}
