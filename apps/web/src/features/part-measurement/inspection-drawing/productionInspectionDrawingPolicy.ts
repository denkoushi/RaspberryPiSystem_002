import { isInspectionDrawingEvaluationTemplateDto } from './inspectionDrawingTemplateBuckets';
import { templateSupportsInspectionDrawing } from './templateItemMappers';

import type { PartMeasurementSheetDto, PartMeasurementTemplateDto } from '../types';

/** 図面中心UIへ送る数量（本番・評価共通） */
export const INSPECTION_DRAWING_UI_QUANTITY = 1;

export function sheetQuantityForInspectionDrawing(sheet: { quantity: number | null }): number {
  return sheet.quantity ?? 1;
}

export function productionTemplateEligibleForInspectionDrawingUi(
  template: PartMeasurementTemplateDto | null | undefined
): boolean {
  if (!template || isInspectionDrawingEvaluationTemplateDto(template)) {
    return false;
  }
  const drawingPath = template.visualTemplate?.drawingImageRelativePath;
  return templateSupportsInspectionDrawing(template.items, drawingPath);
}

/** 本番テンプレ・数量ちょうど1・図面対応 */
export function sheetUsesProductionInspectionDrawingUi(sheet: PartMeasurementSheetDto | null): boolean {
  if (!sheet?.template) return false;
  if (isInspectionDrawingEvaluationTemplateDto(sheet.template)) return false;
  if (sheet.quantity !== INSPECTION_DRAWING_UI_QUANTITY) return false;
  const drawingPath = sheet.template.visualTemplate?.drawingImageRelativePath;
  return templateSupportsInspectionDrawing(sheet.template.items, drawingPath);
}

export function sheetUsesInspectionDrawingEvaluationUi(sheet: PartMeasurementSheetDto | null): boolean {
  if (!sheet?.template || !isInspectionDrawingEvaluationTemplateDto(sheet.template)) {
    return false;
  }
  return sheetQuantityForInspectionDrawing(sheet) === INSPECTION_DRAWING_UI_QUANTITY;
}

export type InspectionDrawingEditMode = 'evaluation' | 'production' | 'none';

export function resolveInspectionDrawingEditMode(sheet: PartMeasurementSheetDto | null): InspectionDrawingEditMode {
  if (!sheet?.template) return 'none';
  if (isInspectionDrawingEvaluationTemplateDto(sheet.template)) {
    return sheetUsesInspectionDrawingEvaluationUi(sheet) ? 'evaluation' : 'none';
  }
  return sheetUsesProductionInspectionDrawingUi(sheet) ? 'production' : 'none';
}

export type InspectionDrawingEditAccess = {
  mode: InspectionDrawingEditMode;
  /** 図面中心画面を開いてよい（閲覧含む） */
  allowed: boolean;
  reason?: string;
};

export function getInspectionDrawingEditAccess(
  sheet: PartMeasurementSheetDto | null
): InspectionDrawingEditAccess {
  if (!sheet) {
    return { mode: 'none', allowed: false };
  }

  const drawingPath = sheet.template?.visualTemplate?.drawingImageRelativePath;
  const drawingOk = templateSupportsInspectionDrawing(sheet.template?.items, drawingPath);

  const mode = resolveInspectionDrawingEditMode(sheet);
  if (mode === 'evaluation' || mode === 'production') {
    if (!drawingOk) {
      return {
        mode: 'none',
        allowed: false,
        reason: 'この記録表は図面中心UIの対象外です（座標・上下限が未設定）。'
      };
    }
    return { mode, allowed: true };
  }

  if (isInspectionDrawingEvaluationTemplateDto(sheet.template)) {
    return {
      mode: 'none',
      allowed: false,
      reason: '数量が2個以上の記録表は、図面中心画面では編集できません。'
    };
  }

  if (sheet.quantity != null && sheet.quantity !== INSPECTION_DRAWING_UI_QUANTITY) {
    return {
      mode: 'none',
      allowed: false,
      reason: '数量が2個以上の記録表は、表形式の測定画面をご利用ください。'
    };
  }

  return {
    mode: 'none',
    allowed: false,
    reason: 'この記録表は図面中心UIの対象外です。通常の測定画面をご利用ください。'
  };
}
