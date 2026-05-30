import type { PartMeasurementSheetDto } from '../types';

/** API の評価用テンプレバケット（`part-measurement-constants` と同期） */
export const PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD = '__INSPECTION_DRAWING_EVAL__';

export function isInspectionDrawingEvaluationTemplateDto(
  template: { fhincd: string } | null | undefined
): boolean {
  return template?.fhincd === PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD;
}

export type InspectionDrawingEvaluationEditAccess = {
  allowed: boolean;
  reason?: string;
};

export function getInspectionDrawingEvaluationEditAccess(
  sheet: PartMeasurementSheetDto | null
): InspectionDrawingEvaluationEditAccess {
  if (!sheet) {
    return { allowed: false };
  }
  if (!isInspectionDrawingEvaluationTemplateDto(sheet.template)) {
    return {
      allowed: false,
      reason:
        'この画面は評価用テンプレートの記録表のみ編集できます。本番の記録表は通常の測定画面をご利用ください。'
    };
  }
  const quantity = sheet.quantity ?? 1;
  if (quantity !== 1) {
    return {
      allowed: false,
      reason: '数量が2個以上の記録表は、この実験用画面では編集・確定できません。'
    };
  }
  return { allowed: true };
}
