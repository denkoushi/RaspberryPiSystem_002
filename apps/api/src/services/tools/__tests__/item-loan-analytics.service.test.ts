import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import { ItemLoanAnalyticsService } from '../item-loan-analytics.service.js';
import type { IItemLoanAnalyticsRepository } from '../item-loan-analytics.types.js';

describe('ItemLoanAnalyticsService', () => {
  it('periodFrom が periodTo より後なら 400', async () => {
    const repo: IItemLoanAnalyticsRepository = {
      loadAggregate: vi.fn(),
      resolveSyntheticItemIdToToolLabel: vi.fn()
    };
    const service = new ItemLoanAnalyticsService(repo);

    await expect(
      service.getDashboard({
        periodFrom: new Date('2026-02-01'),
        periodTo: new Date('2026-01-01')
      })
    ).rejects.toThrow(ApiError);
    expect(repo.loadAggregate).not.toHaveBeenCalled();
  });

  it('集計結果を ItemLoanAnalyticsResponse にマッピングする', async () => {
    const due = new Date('2026-01-20T09:00:00.000Z');
    const repo: IItemLoanAnalyticsRepository = {
      resolveSyntheticItemIdToToolLabel: vi.fn(),
      loadAggregate: vi.fn().mockResolvedValue({
        monthlyTrend: [{ yearMonth: '2026-01', borrowCount: 7, returnCount: 6 }],
        periodBorrowCount: 40,
        periodReturnCount: 38,
        openLoanCount: 5,
        overdueOpenCount: 2,
        totalItemsActive: 48,
        itemRows: [
          {
            itemId: 'i1',
            itemCode: 'TO0001',
            name: 'タップ M6',
            status: 'IN_USE',
            periodBorrowCount: 12,
            periodReturnCount: 11,
            open: {
              dueAt: due,
              employeeDisplayName: '山田',
              employeeCode: 'E01',
              isOverdue: true
            }
          },
          {
            itemId: 'i2',
            itemCode: 'TO0002',
            name: 'ドリル Φ6',
            status: 'AVAILABLE',
            periodBorrowCount: 0,
            periodReturnCount: 0,
            open: null
          }
        ],
        employeeRows: [
          {
            employeeId: 'e1',
            displayName: '山田',
            employeeCode: 'E01',
            openItemCount: 2,
            periodBorrowCount: 20,
            periodReturnCount: 19
          }
        ]
      })
    };

    const service = new ItemLoanAnalyticsService(repo);
    const result = await service.getDashboard({
      periodFrom: new Date('2026-01-01'),
      periodTo: new Date('2026-01-31'),
      monthlyMonths: 6,
      timeZone: 'Asia/Tokyo'
    });

    expect(result.summary.totalItemsActive).toBe(48);
    expect(result.byItem[0].isOutNow).toBe(true);
    expect(result.byItem[0].openIsOverdue).toBe(true);
    expect(result.byItem[0].dueAt).toBe(due.toISOString());
    expect(result.byItem[1].isOutNow).toBe(false);
    expect(result.byItem[1].openIsOverdue).toBe(false);
    expect(result.byEmployee[0].openItemCount).toBe(2);
    expect(repo.loadAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlyMonths: 6,
        timeZone: 'Asia/Tokyo',
        periodFrom: expect.any(Date),
        periodTo: expect.any(Date),
        now: expect.any(Date)
      })
    );
  });
});
