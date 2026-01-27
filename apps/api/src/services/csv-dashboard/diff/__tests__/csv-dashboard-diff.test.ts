import { describe, expect, it } from 'vitest';
import { computeCsvDashboardDedupDiff } from '../csv-dashboard-diff.js';

describe('computeCsvDashboardDedupDiff', () => {
  it('updates when incoming updatedAt is newer even if completed', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        {
          data: { productNo: '1', progress: '', updatedAt: '2026/01/26 10:00' },
          occurredAt: new Date('2026-01-26T01:00:00Z'),
          hash: 'hash-1'
        }
      ],
      existingRows: [
        {
          id: 'row-1',
          dataHash: 'hash-1',
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          rowData: { productNo: '1', progress: '完了', updatedAt: '2026/01/25 10:00' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.rowsAdded).toBe(1);
    expect(result.rowsSkipped).toBe(0);
  });

  it('skips when incoming updatedAt is older or equal', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        {
          data: { productNo: '2', updatedAt: '2026/01/25 10:00' },
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          hash: 'hash-2'
        }
      ],
      existingRows: [
        {
          id: 'row-2',
          dataHash: 'hash-2',
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          rowData: { productNo: '2', updatedAt: '2026/01/26 09:00' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
    expect(result.rowsAdded).toBe(0);
    expect(result.rowsSkipped).toBe(1);
  });

  it('falls back to occurredAt when updatedAt is missing', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        {
          data: { productNo: '3' },
          occurredAt: new Date('2026-01-26T01:00:00Z'),
          hash: 'hash-3'
        }
      ],
      existingRows: [
        {
          id: 'row-3',
          dataHash: 'hash-3',
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          rowData: { productNo: '3' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.rowsAdded).toBe(1);
    expect(result.rowsSkipped).toBe(0);
  });
});
