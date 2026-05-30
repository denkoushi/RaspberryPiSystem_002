import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } from './part-measurement-constants.js';

const inspectionDrawingEvaluationExclusion: Prisma.PartMeasurementTemplateWhereInput = {
  fhincd: { not: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD }
};

const inspectionDrawingEvaluationSheetExclusion: Prisma.PartMeasurementSheetWhereInput = {
  template: { fhincd: { not: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } }
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

/** 本番キオスクの下書き・確定一覧用。評価用テンプレ由来の記録表を除外する。 */
export function productionPartMeasurementSheetWhere(
  baseWhere: Prisma.PartMeasurementSheetWhereInput
): Prisma.PartMeasurementSheetWhereInput {
  return {
    AND: [baseWhere, inspectionDrawingEvaluationSheetExclusion]
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
/** 通常の記録表 API（PATCH / finalize 等）で評価用シートを操作しない */
export function assertProductionPartMeasurementSheet(sheet: {
  template: { fhincd: string } | null;
}): void {
  if (sheet.template && isInspectionDrawingEvaluationTemplate(sheet.template)) {
    throw new ApiError(
      409,
      '評価用記録表は通常の記録表 API では操作できません。inspection-drawing/evaluation-sheets を使用してください'
    );
  }
}

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
