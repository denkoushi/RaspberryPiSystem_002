import { describe, expect, it } from 'vitest';

import {
  buildRowDisplayItemId,
  buildSplitDisplayItemId
} from '../leaderboard-display-item-id.js';
import {
  compareDisplayItemManualSortKeys,
  sortExpandedProductionScheduleRowsByManualOrder
} from '../production-schedule-order-split.service.js';
import type { ProductionScheduleRow } from '../../production-schedule-query.service.js';

describe('display-item-manual-sort', () => {
  const parentA = '11111111-1111-4111-8111-111111111111';
  const parentB = '22222222-2222-4222-8222-222222222222';
  const splitA1 = '33333333-3333-4333-8333-333333333333';
  const splitA2 = '44444444-4444-4444-8444-444444444444';

  it('orders split display items by manual processingOrder across parent rows', () => {
    const parentSequenceBySourceRowId = new Map([
      [parentA, 0],
      [parentB, 1]
    ]);

    const rows: ProductionScheduleRow[] = [
      {
        id: buildSplitDisplayItemId(splitA1),
        sourceRowId: parentA,
        splitId: splitA1,
        splitNo: 1,
        processingOrder: 2,
        isSplit: true,
        seibanJoinKey: null,
        occurredAt: new Date(),
        rowData: {},
        globalRank: null,
        actualPerPieceMinutes: null,
        note: null,
        processingType: null,
        dueDate: null,
        plannedQuantity: 2,
        plannedStartDate: null,
        plannedEndDate: null,
        customerName: null
      },
      {
        id: buildSplitDisplayItemId(splitA2),
        sourceRowId: parentA,
        splitId: splitA2,
        splitNo: 2,
        processingOrder: 9,
        isSplit: true,
        seibanJoinKey: null,
        occurredAt: new Date(),
        rowData: {},
        globalRank: null,
        actualPerPieceMinutes: null,
        note: null,
        processingType: null,
        dueDate: null,
        plannedQuantity: 3,
        plannedStartDate: null,
        plannedEndDate: null,
        customerName: null
      },
      {
        id: buildRowDisplayItemId(parentB),
        sourceRowId: parentB,
        splitId: null,
        splitNo: null,
        processingOrder: 5,
        isSplit: false,
        seibanJoinKey: null,
        occurredAt: new Date(),
        rowData: {},
        globalRank: null,
        actualPerPieceMinutes: null,
        note: null,
        processingType: null,
        dueDate: null,
        plannedQuantity: 1,
        plannedStartDate: null,
        plannedEndDate: null,
        customerName: null
      }
    ];

    const sorted = sortExpandedProductionScheduleRowsByManualOrder(rows, parentSequenceBySourceRowId);
    expect(sorted.map((row) => row.processingOrder)).toEqual([2, 5, 9]);
  });

  it('places manual-order items before null-order items', () => {
    expect(
      compareDisplayItemManualSortKeys(
        { processingOrder: 3, parentSequence: 1, splitNo: null, stableId: 'b' },
        { processingOrder: null, parentSequence: 0, splitNo: null, stableId: 'a' }
      )
    ).toBeLessThan(0);
  });
});
