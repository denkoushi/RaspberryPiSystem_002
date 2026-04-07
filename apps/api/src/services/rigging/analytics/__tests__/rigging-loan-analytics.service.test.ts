import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/errors.js';
import { RiggingLoanAnalyticsService } from '../rigging-loan-analytics.service.js';
import type { IRiggingLoanAnalyticsRepository } from '../rigging-loan-analytics.types.js';

describe('RiggingLoanAnalyticsService', () => {
  it('periodFrom が periodTo より後なら 400', async () => {
    const repo: IRiggingLoanAnalyticsRepository = {
      loadAggregate: vi.fn()
    };
    const service = new RiggingLoanAnalyticsService(repo);
    await expect(
      service.getDashboard({
        periodFrom: new Date('2026-02-01'),
        periodTo: new Date('2026-01-01')
      })
    ).rejects.toThrow(ApiError);
    expect(repo.loadAggregate).not.toHaveBeenCalled();
  });

  it('集計結果を RiggingLoanAnalyticsResponse にマッピングする', async () => {
    const due = new Date('2026-01-15T10:00:00.000Z');
    const repo: IRiggingLoanAnalyticsRepository = {
      loadAggregate: vi.fn().mockResolvedValue({
        monthlyTrend: [{ yearMonth: '2026-01', borrowCount: 2, returnCount: 1 }],
        periodBorrowCount: 5,
        periodReturnCount: 4,
        openLoanCount: 3,
        overdueOpenCount: 1,
        totalRiggingGearsActive: 10,
        gearRows: [
          {
            gearId: 'g1',
            managementNumber: 'M-001',
            name: 'Wire A',
            status: 'AVAILABLE',
            periodBorrowCount: 2,
            periodReturnCount: 1,
            open: {
              dueAt: due,
              employeeDisplayName: '山田',
              employeeCode: 'E01',
              isOverdue: true
            }
          },
          {
            gearId: 'g2',
            managementNumber: 'M-002',
            name: 'Belt B',
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
            openRiggingCount: 1,
            periodBorrowCount: 2,
            periodReturnCount: 1
          }
        ]
      })
    };
    const service = new RiggingLoanAnalyticsService(repo);
    const result = await service.getDashboard({
      periodFrom: new Date('2026-01-01'),
      periodTo: new Date('2026-01-31'),
      monthlyMonths: 6,
      timeZone: 'Asia/Tokyo'
    });

    expect(result.summary.openLoanCount).toBe(3);
    expect(result.byGear[0].isOutNow).toBe(true);
    expect(result.byGear[0].openIsOverdue).toBe(true);
    expect(result.byGear[0].dueAt).toBe(due.toISOString());
    expect(result.byGear[1].isOutNow).toBe(false);
    expect(result.byGear[1].openIsOverdue).toBe(false);
    expect(result.monthlyTrend).toHaveLength(1);
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
