import { describe, expect, it } from 'vitest';

import { mergeManualOrderOverviewResourcesWithAssignmentOrder } from '../due-management-manual-order-overview.service.js';

const sampleDerived = [
  {
    resourceCd: '305',
    assignedCount: 1,
    maxOrderNumber: 1 as number | null,
    avgGlobalRankGap: null,
    comparedCount: 0,
    missingGlobalRankCount: 0,
    lastUpdatedAt: null,
    lastUpdatedBy: null,
    rows: [{ orderNumber: 1, fseiban: 'A', fhincd: 'x', processLabel: '', machineName: '', partName: '' }]
  },
  {
    resourceCd: '500',
    assignedCount: 1,
    maxOrderNumber: 2 as number | null,
    avgGlobalRankGap: null,
    comparedCount: 0,
    missingGlobalRankCount: 0,
    lastUpdatedAt: null,
    lastUpdatedBy: null,
    rows: [{ orderNumber: 2, fseiban: 'B', fhincd: 'y', processLabel: '', machineName: '', partName: '' }]
  }
];

describe('mergeManualOrderOverviewResourcesWithAssignmentOrder', () => {
  it('orders by assignment first then appends unassigned derived resources', () => {
    const merged = mergeManualOrderOverviewResourcesWithAssignmentOrder(['500', '080'], sampleDerived);
    expect(merged.map((r) => r.resourceCd)).toEqual(['500', '080', '305']);
    expect(merged[1]!.rows).toEqual([]);
    expect(merged[1]!.assignedCount).toBe(0);
  });

  it('empty assignment order yields only derived tail (overview は割当なし端末では merge を呼ばない)', () => {
    const merged = mergeManualOrderOverviewResourcesWithAssignmentOrder([], sampleDerived);
    expect(merged.map((r) => r.resourceCd)).toEqual(['305', '500']);
  });
});
