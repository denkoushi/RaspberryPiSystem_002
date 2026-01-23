import { describe, expect, it } from 'vitest';
import { computeCsvDashboardDedupDiff } from '../csv-dashboard-diff.js';

describe('computeCsvDashboardDedupDiff', () => {
  it('skips rows without hash and keeps completed rows', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        { data: { productNo: '1' }, occurredAt: new Date('2024-01-01') },
        { data: { productNo: '2' }, occurredAt: new Date('2024-01-02'), hash: 'hash-2' }
      ],
      existingRows: [
        {
          id: 'row-1',
          dataHash: 'hash-2',
          occurredAt: new Date('2024-01-01'),
          rowData: { progress: '完了', productNo: '2' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
    expect(result.rowsAdded).toBe(0);
    expect(result.rowsSkipped).toBe(2);
  });

  it('creates new rows and updates changed rows', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        { data: { productNo: '1' }, occurredAt: new Date('2024-01-01'), hash: 'hash-1' },
        { data: { productNo: '2', progress: '' }, occurredAt: new Date('2024-01-02'), hash: 'hash-2' }
      ],
      existingRows: [
        {
          id: 'row-2',
          dataHash: 'hash-2',
          occurredAt: new Date('2024-01-01'),
          rowData: { productNo: '2', progress: '未完了' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(1);
    expect(result.updates).toHaveLength(1);
    expect(result.rowsAdded).toBe(2);
    expect(result.rowsSkipped).toBe(0);
  });

  it('skips unchanged rows', () => {
    const occurredAt = new Date('2024-01-01');
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        { data: { productNo: '1' }, occurredAt, hash: 'hash-1' }
      ],
      existingRows: [
        {
          id: 'row-1',
          dataHash: 'hash-1',
          occurredAt,
          rowData: { productNo: '1' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
    expect(result.rowsAdded).toBe(0);
    expect(result.rowsSkipped).toBe(1);
  });
});
