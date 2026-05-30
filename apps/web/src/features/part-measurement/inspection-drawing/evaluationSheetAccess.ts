import {
  getInspectionDrawingEditAccess,
  type InspectionDrawingEditAccess as UnifiedInspectionDrawingEditAccess
} from './productionInspectionDrawingPolicy';
export {
  isInspectionDrawingEvaluationTemplateDto,
  PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD
} from './inspectionDrawingTemplateBuckets';

import type { PartMeasurementSheetDto } from '../types';

/** @deprecated 互換のため残す。新規は `getInspectionDrawingEditAccess` を使う */
export type InspectionDrawingEvaluationEditAccess = {
  allowed: boolean;
  reason?: string;
};

/** 評価用テンプレの記録表のみ「許可」扱い（本番 sheet は拒否） */
export function getInspectionDrawingEvaluationEditAccess(
  sheet: PartMeasurementSheetDto | null
): InspectionDrawingEvaluationEditAccess {
  const access = getInspectionDrawingEditAccess(sheet);
  if (access.mode === 'evaluation') {
    return { allowed: access.allowed, reason: access.reason };
  }
  if (access.mode === 'production') {
    return {
      allowed: false,
      reason: '本番の記録表はこの評価専用画面では編集できません。日程・一覧から開いた図面画面をご利用ください。'
    };
  }
  return { allowed: false, reason: access.reason };
}

export type { UnifiedInspectionDrawingEditAccess as InspectionDrawingEditAccess };
export { getInspectionDrawingEditAccess };
