import { describe, expect, it } from 'vitest';

import {
  mergeManualOrderOverviewResourcesWithAssignmentOrder,
  resolveManualOrderOverviewResourcesForAssignedDevice
} from '../due-management-manual-order-overview.service.js';

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
    rows: [
      {
        orderNumber: 1,
        fseiban: 'A',
        fhincd: 'x',
        processOrderLabel: '',
        processLabel: '',
        machineName: '',
        partName: ''
      }
    ]
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
    rows: [
      {
        orderNumber: 2,
        fseiban: 'B',
        fhincd: 'y',
        processOrderLabel: '',
        processLabel: '',
        machineName: '',
        partName: ''
      }
    ]
  }
];

describe('mergeManualOrderOverviewResourcesWithAssignmentOrder', () => {
  it('returns only assignment order slots; does not append derived resources outside assignment', () => {
    const merged = mergeManualOrderOverviewResourcesWithAssignmentOrder(['500', '080'], sampleDerived);
    expect(merged.map((r) => r.resourceCd)).toEqual(['500', '080']);
    expect(merged[1]!.rows).toEqual([]);
    expect(merged[1]!.assignedCount).toBe(0);
  });

  it('empty assignment order yields only derived tail (overview は割当なし端末では merge を呼ばない)', () => {
    const merged = mergeManualOrderOverviewResourcesWithAssignmentOrder([], sampleDerived);
    expect(merged.map((r) => r.resourceCd)).toEqual(['305', '500']);
  });
});

describe('resolveManualOrderOverviewResourcesForAssignedDevice', () => {
  it('prefers site-scope resource over device-slice legacy resource', () => {
    const siteScopeDerived = [
      {
        resourceCd: '581',
        assignedCount: 1,
        maxOrderNumber: 1 as number | null,
        avgGlobalRankGap: null,
        comparedCount: 0,
        missingGlobalRankCount: 0,
        lastUpdatedAt: null,
        lastUpdatedBy: null,
        rows: [
          {
            orderNumber: 1,
            fseiban: 'S',
            fhincd: 'site',
            processOrderLabel: '',
            processLabel: '',
            machineName: '',
            partName: ''
          }
        ]
      }
    ];
    const sliceDerived = [
      {
        resourceCd: '500',
        assignedCount: 1,
        maxOrderNumber: 2 as number | null,
        avgGlobalRankGap: null,
        comparedCount: 0,
        missingGlobalRankCount: 0,
        lastUpdatedAt: null,
        lastUpdatedBy: null,
        rows: [
          {
            orderNumber: 2,
            fseiban: 'L',
            fhincd: 'legacy',
            processOrderLabel: '',
            processLabel: '',
            machineName: '',
            partName: ''
          }
        ]
      }
    ];

    const resolved = resolveManualOrderOverviewResourcesForAssignedDevice({
      assignmentOrder: ['581'],
      siteScopeDerivedResources: siteScopeDerived,
      sliceDerivedResources: sliceDerived
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.resourceCd).toBe('581');
    expect(resolved[0]?.rows[0]?.fhincd).toBe('site');
  });

  it('falls back to slice resource when site-scope lacks assigned cd', () => {
    const siteScopeDerived: typeof sampleDerived = [];
    const sliceDerived = [sampleDerived[1]!];

    const resolved = resolveManualOrderOverviewResourcesForAssignedDevice({
      assignmentOrder: ['500'],
      siteScopeDerivedResources: siteScopeDerived,
      sliceDerivedResources: sliceDerived
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.resourceCd).toBe('500');
    expect(resolved[0]?.rows).toHaveLength(1);
  });

  it('returns empty resources when device has no assignment order', () => {
    const resolved = resolveManualOrderOverviewResourcesForAssignedDevice({
      assignmentOrder: [],
      siteScopeDerivedResources: sampleDerived,
      sliceDerivedResources: sampleDerived
    });

    expect(resolved).toEqual([]);
  });
});
