import { z } from 'zod';

/** 検査図面実験用 PATCH: 数量1・個体0のみ（通常 patch スキーマより厳格） */
export const patchInspectionDrawingEvaluationSheetBodySchema = z.object({
  quantity: z.literal(1).optional(),
  employeeTagUid: z.string().min(1).max(200).optional().nullable(),
  clearEmployee: z.boolean().optional(),
  results: z
    .array(
      z.object({
        pieceIndex: z.literal(0),
        templateItemId: z.string().uuid(),
        value: z.union([z.string(), z.number(), z.null()]).optional()
      })
    )
    .optional()
});

export type PatchInspectionDrawingEvaluationSheetBody = z.infer<
  typeof patchInspectionDrawingEvaluationSheetBodySchema
>;

/** 評価用 patch 入力を正規化（quantity は常に 1 に固定） */
export function toInspectionDrawingEvaluationPatchInput(
  body: PatchInspectionDrawingEvaluationSheetBody
): PatchInspectionDrawingEvaluationSheetBody & { quantity: 1 } {
  return {
    ...body,
    quantity: 1,
    results: body.results?.map((r) => ({ ...r, pieceIndex: 0 as const }))
  };
}
