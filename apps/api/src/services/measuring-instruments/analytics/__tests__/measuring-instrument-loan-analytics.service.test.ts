import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/errors.js';
import { MeasuringInstrumentLoanAnalyticsService } from '../measuring-instrument-loan-analytics.service.js';
import type { IMeasuringInstrumentLoanAnalyticsRepository } from '../measuring-instrument-loan-analytics.types.js';

describe('MeasuringInstrumentLoanAnalyticsService', () => {
  it('periodFrom が periodTo より後なら 400', async () => {
    const repo: IMeasuringInstrumentLoanAnalyticsRepository = {
      loadAggregate: vi.fn(),
    };
    const service = new MeasuringInstrumentLoanAnalyticsService(repo);
    await expect(
      service.getDashboard({
        periodFrom: new Date('2026-02-01'),
        periodTo: new Date('2026-01-01'),
      })
    ).rejects.toThrow(ApiError);
    expect(repo.loadAggregate).not.toHaveBeenCalled();
  });

  it('集計結果を MeasuringInstrumentLoanAnalyticsResponse にマッピングする', async () => {
    const due = new Date('2026-01-20T09:00:00.000Z');
    const repo: IMeasuringInstrumentLoanAnalyticsRepository = {
      loadAggregate: vi.fn().mockResolvedValue({
        monthlyTrend: [{ yearMonth: '2026-01', borrowCount: 8, returnCount: 6 }],
        periodBorrowCount: 20,
        periodReturnCount: 19,
        openLoanCount: 2,
        overdueOpenCount: 1,
        totalInstrumentsActive: 15,
        instrumentRows: [
          {
            instrumentId: 'm1',
            managementNumber: 'MI-001',
            name: 'ノギス',
            status: 'IN_USE',
            periodBorrowCount: 4,
            periodReturnCount: 3,
            open: {
              borrowerName: '山田 太郎',
              expectedReturnAt: due,
              isOverdue: true,
            },
          },
        ],
        periodEventRows: [
          {
            kind: 'BORROW',
            eventAt: new Date('2026-01-10T08:00:00.000Z'),
            assetId: 'a1',
            assetLabel: 'asset',
            actorDisplayName: '山田',
            actorEmployeeId: 'e1'
          }
        ],
        employeeRows: [
          {
            employeeId: 'e1',
            displayName: '山田太郎',
            employeeCode: 'EMP001',
            openInstrumentCount: 1,
            overdueOpenInstrumentCount: 1,
            periodBorrowCount: 4,
            periodReturnCount: 3,
          },
        ],
      }),
    };
    const service = new MeasuringInstrumentLoanAnalyticsService(repo);
    const result = await service.getDashboard({
      periodFrom: new Date('2026-01-01'),
      periodTo: new Date('2026-01-31'),
      monthlyMonths: 6,
      timeZone: 'Asia/Tokyo',
    });

    expect(result.summary.openLoanCount).toBe(2);
    expect(result.byInstrument[0].isOutNow).toBe(true);
    expect(result.byInstrument[0].openIsOverdue).toBe(true);
    expect(result.byInstrument[0].dueAt).toBe(due.toISOString());
    expect(result.byEmployee[0].openInstrumentCount).toBe(1);
    expect(result.byEmployee[0].overdueOpenInstrumentCount).toBe(1);
    expect(result.periodEvents).toHaveLength(1);
    expect(repo.loadAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlyMonths: 6,
        timeZone: 'Asia/Tokyo',
        periodFrom: expect.any(Date),
        periodTo: expect.any(Date),
        now: expect.any(Date),
      })
    );
  });
});
