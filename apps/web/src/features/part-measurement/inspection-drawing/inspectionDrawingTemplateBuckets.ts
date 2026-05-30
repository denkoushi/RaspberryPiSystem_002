/** API の評価用テンプレバケット（`part-measurement-constants` と同期） */
export const PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD = '__INSPECTION_DRAWING_EVAL__';

export function isInspectionDrawingEvaluationTemplateDto(
  template: { fhincd: string } | null | undefined
): boolean {
  return template?.fhincd === PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD;
}
