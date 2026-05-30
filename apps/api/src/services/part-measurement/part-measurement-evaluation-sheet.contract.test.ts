import { describe, expect, it } from 'vitest';

import {
  patchInspectionDrawingEvaluationSheetBodySchema,
  toInspectionDrawingEvaluationPatchInput
} from './part-measurement-evaluation-sheet.contract.js';

describe('patchInspectionDrawingEvaluationSheetBodySchema', () => {
  it('rejects quantity other than 1', () => {
    const result = patchInspectionDrawingEvaluationSheetBodySchema.safeParse({
      quantity: 2
    });
    expect(result.success).toBe(false);
  });

  it('rejects pieceIndex other than 0', () => {
    const result = patchInspectionDrawingEvaluationSheetBodySchema.safeParse({
      results: [
        {
          pieceIndex: 1,
          templateItemId: '00000000-0000-4000-8000-000000000001'
        }
      ]
    });
    expect(result.success).toBe(false);
  });

  it('normalizes patch input to quantity 1 and pieceIndex 0', () => {
    const parsed = patchInspectionDrawingEvaluationSheetBodySchema.parse({
      results: [
        {
          pieceIndex: 0,
          templateItemId: '00000000-0000-4000-8000-000000000001',
          value: '1.23'
        }
      ]
    });
    const normalized = toInspectionDrawingEvaluationPatchInput(parsed);
    expect(normalized.quantity).toBe(1);
    expect(normalized.results?.[0]?.pieceIndex).toBe(0);
  });
});
