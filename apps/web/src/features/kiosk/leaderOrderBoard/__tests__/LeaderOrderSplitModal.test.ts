import { describe, expect, it } from 'vitest';

import { validateSplitDrafts, type DraftSplitItem } from '../LeaderOrderSplitModal';

const draft = (patch: Partial<DraftSplitItem>): DraftSplitItem => ({
  splitNo: 1,
  splitQuantity: '1',
  dueDate: '',
  plannedStartDate: '',
  plannedEndDate: '',
  orderNumber: '',
  ...patch
});

describe('validateSplitDrafts', () => {
  it('手動順番の重複を保存前に検出する', () => {
    const message = validateSplitDrafts({
      plannedQuantity: 5,
      drafts: [
        draft({ splitNo: 1, splitQuantity: '2', orderNumber: '1' }),
        draft({ splitNo: 2, splitQuantity: '3', orderNumber: '1' })
      ]
    });

    expect(message).toBe('手動順番が重複しています');
  });

  it('数量合計が指示数と一致すれば valid', () => {
    const message = validateSplitDrafts({
      plannedQuantity: 5,
      drafts: [
        draft({ splitNo: 1, splitQuantity: '2', orderNumber: '1' }),
        draft({ splitNo: 2, splitQuantity: '3', orderNumber: '2' })
      ]
    });

    expect(message).toBeNull();
  });
});
