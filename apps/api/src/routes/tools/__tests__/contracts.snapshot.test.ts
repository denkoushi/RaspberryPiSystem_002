import { describe, expect, it } from 'vitest';

import {
  activeLoanQuerySchema,
  borrowSchema,
  cancelSchema,
  photoLabelReviewListQuerySchema,
  photoLabelReviewPatchBodySchema,
  returnSchema
} from '../loans/schemas';

const keysOf = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape).sort();

describe('破壊的変更検知: loans系ペイロードのキー構造', () => {
  it('borrow schema keys are stable', () => {
    expect(keysOf(borrowSchema)).toEqual([
      'clientId',
      'dueAt',
      'employeeTagUid',
      'itemTagUid',
      'note'
    ]);
  });

  it('return schema keys are stable', () => {
    expect(keysOf(returnSchema)).toEqual(['clientId', 'loanId', 'note', 'performedByUserId']);
  });

  it('active loans query schema keys are stable', () => {
    expect(keysOf(activeLoanQuerySchema)).toEqual(['clientId']);
  });

  it('cancel schema keys are stable', () => {
    expect(keysOf(cancelSchema)).toEqual(['clientId', 'loanId', 'performedByUserId']);
  });

  it('photo label review list query schema keys are stable', () => {
    expect(keysOf(photoLabelReviewListQuerySchema)).toEqual(['limit']);
  });

  it('photo label review patch body schema keys are stable', () => {
    expect(keysOf(photoLabelReviewPatchBodySchema)).toEqual(['humanDisplayName', 'quality']);
  });
});

