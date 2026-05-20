import { describe, expect, it } from 'vitest';

import {
  groupStaleCandidatesForRelease,
  type StaleOrderAssignmentCandidate,
} from '../order-assignment-release.repository.js';
import { reconcileStaleProductionScheduleOrderAssignments } from '../order-assignment-reconciliation.service.js';

describe('groupStaleCandidatesForRelease', () => {
  it('orders by location, resourceCd, then orderNumber DESC for safe batch release', () => {
    const candidates: StaleOrderAssignmentCandidate[] = [
      { csvDashboardRowId: 'r3', location: 'L1', resourceCd: '080', orderNumber: 3 },
      { csvDashboardRowId: 'r1', location: 'L1', resourceCd: '080', orderNumber: 1 },
      { csvDashboardRowId: 'r4', location: 'L1', resourceCd: '080', orderNumber: 4 },
      { csvDashboardRowId: 'r2', location: 'L1', resourceCd: '080', orderNumber: 2 },
    ];

    expect(groupStaleCandidatesForRelease(candidates).map((c) => c.orderNumber)).toEqual([4, 3, 2, 1]);
  });

  it('deduplicates identical row/location entries', () => {
    const candidates: StaleOrderAssignmentCandidate[] = [
      { csvDashboardRowId: 'r1', location: 'L1', resourceCd: '080', orderNumber: 2 },
      { csvDashboardRowId: 'r1', location: 'L1', resourceCd: '080', orderNumber: 2 },
    ];

    expect(groupStaleCandidatesForRelease(candidates)).toHaveLength(1);
  });

  it('reconcile releases candidates in descending order per resource', async () => {
    const released: Array<string> = [];
    const executor = {
      productionScheduleOrderAssignment: {
        findUnique: async ({ where }: { where: { csvDashboardRowId_location: { csvDashboardRowId: string; location: string } } }) => ({
          orderNumber:
            where.csvDashboardRowId_location.csvDashboardRowId === 'r4'
              ? 4
              : where.csvDashboardRowId_location.csvDashboardRowId === 'r3'
                ? 3
                : 2,
          resourceCd: '080',
        }),
        delete: async ({ where }: { where: { csvDashboardRowId_location: { csvDashboardRowId: string; location: string } } }) => {
          released.push(where.csvDashboardRowId_location.csvDashboardRowId);
          return {};
        },
        updateMany: async () => ({ count: 1 }),
      },
      $queryRaw: async () => [],
    };

    const result = await reconcileStaleProductionScheduleOrderAssignments(
      executor as never,
      [
        { csvDashboardRowId: 'r2', location: 'L1', resourceCd: '080', orderNumber: 2 },
        { csvDashboardRowId: 'r4', location: 'L1', resourceCd: '080', orderNumber: 4 },
        { csvDashboardRowId: 'r3', location: 'L1', resourceCd: '080', orderNumber: 3 },
      ]
    );

    expect(released).toEqual(['r4', 'r3', 'r2']);
    expect(result).toEqual({ scanned: 3, released: 3 });
  });
});
