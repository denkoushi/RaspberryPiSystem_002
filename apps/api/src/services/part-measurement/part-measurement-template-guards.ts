import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } from './part-measurement-constants.js';

const inspectionDrawingEvaluationExclusion: Prisma.PartMeasurementTemplateWhereInput = {
  fhincd: { not: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD }
};

/**
 * 本番向けテンプレート検索用。評価用バケット除外を AND で合成する（baseWhere と同階層に fhincd を置かない）。
 */
export function productionPartMeasurementTemplateWhere(
  baseWhere: Prisma.PartMeasurementTemplateWhereInput
): Prisma.PartMeasurementTemplateWhereInput {
  return {
    AND: [baseWhere, inspectionDrawingEvaluationExclusion]
  };
}

export function isInspectionDrawingEvaluationTemplate(template: { fhincd: string }): boolean {
  return template.fhincd === PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD;
}

export function assertOperableProductionPartMeasurementTemplate(template: { fhincd: string }): void {
  if (isInspectionDrawingEvaluationTemplate(template)) {
    throw new ApiError(
      409,
      '検査図面 MVP の評価用テンプレートは、一覧・改版・退役・流用の対象にできません'
    );
  }
}

/** 検査図面実験用編集 UI（URL 直打ち）で保存・確定してよい記録表か */
export function assertInspectionDrawingEvaluationSheet(sheet: {
  quantity: number | null;
  template: { fhincd: string; processGroup: string } | null;
}): void {
  if (!sheet.template) {
    throw new ApiError(404, 'テンプレートが見つかりません');
  }
  if (!isInspectionDrawingEvaluationTemplate(sheet.template)) {
    throw new ApiError(
      409,
      '検査図面実験用UIは評価用テンプレート（__INSPECTION_DRAWING_EVAL__）の記録表のみ編集できます'
    );
  }
  if (sheet.template.processGroup !== 'CANDIDATE_FHINMEI_ONLY') {
    throw new ApiError(409, '検査図面実験用UIの対象外テンプレートです');
  }
  const quantity = sheet.quantity ?? 1;
  if (quantity !== 1) {
    throw new ApiError(409, '検査図面実験用UIは数量1の記録表のみ対応しています');
  }
}
