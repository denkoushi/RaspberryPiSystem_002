import type { MeasuringInstrumentLoanAnalyticsResponse } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { MeasuringInstrumentLoanAnalyticsRepository } from './measuring-instrument-loan-analytics.repository.js';
import type {
  IMeasuringInstrumentLoanAnalyticsRepository,
  MeasuringInstrumentLoanAnalyticsQueryInput,
  MeasuringInstrumentLoanAnalyticsTimeZone,
} from './measuring-instrument-loan-analytics.types.js';

const DEFAULT_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_MONTHS = 6;

export type MeasuringInstrumentLoanAnalyticsPublicQuery = {
  periodFrom?: Date;
  periodTo?: Date;
  monthlyMonths?: number;
  timeZone?: MeasuringInstrumentLoanAnalyticsTimeZone;
  measuringInstrumentId?: string;
};

export class MeasuringInstrumentLoanAnalyticsService {
  constructor(private readonly repository: IMeasuringInstrumentLoanAnalyticsRepository) {}

  static createDefault(): MeasuringInstrumentLoanAnalyticsService {
    return new MeasuringInstrumentLoanAnalyticsService(new MeasuringInstrumentLoanAnalyticsRepository());
  }

  async getDashboard(query: MeasuringInstrumentLoanAnalyticsPublicQuery): Promise<MeasuringInstrumentLoanAnalyticsResponse> {
    const now = new Date();
    const periodTo = query.periodTo ?? now;
    const periodFrom = query.periodFrom ?? new Date(periodTo.getTime() - DEFAULT_RANGE_MS);
    if (periodFrom.getTime() > periodTo.getTime()) {
      throw new ApiError(400, 'periodFrom は periodTo 以前である必要があります');
    }

    const monthlyMonths = Math.min(24, Math.max(1, query.monthlyMonths ?? DEFAULT_MONTHS));
    const timeZone: MeasuringInstrumentLoanAnalyticsTimeZone = query.timeZone ?? 'Asia/Tokyo';

    if (query.measuringInstrumentId) {
      const inst = await prisma.measuringInstrument.findUnique({
        where: { id: query.measuringInstrumentId },
      });
      if (!inst) {
        throw new ApiError(404, '計測機器が見つかりません');
      }
    }

    const input: MeasuringInstrumentLoanAnalyticsQueryInput = {
      periodFrom,
      periodTo,
      monthlyMonths,
      timeZone,
      now,
      measuringInstrumentId: query.measuringInstrumentId,
    };
    const agg = await this.repository.loadAggregate(input);

    return {
      meta: {
        timeZone,
        periodFrom: periodFrom.toISOString(),
        periodTo: periodTo.toISOString(),
        monthlyMonths,
        generatedAt: now.toISOString(),
      },
      summary: {
        openLoanCount: agg.openLoanCount,
        overdueOpenCount: agg.overdueOpenCount,
        totalInstrumentsActive: agg.totalInstrumentsActive,
        periodBorrowCount: agg.periodBorrowCount,
        periodReturnCount: agg.periodReturnCount,
      },
      monthlyTrend: agg.monthlyTrend,
      byInstrument: agg.instrumentRows.map((row) => {
        const isOutNow = row.open !== null;
        return {
          instrumentId: row.instrumentId,
          managementNumber: row.managementNumber,
          name: row.name,
          status: row.status,
          isOutNow,
          currentBorrowerDisplayName: row.open?.borrowerName ?? null,
          dueAt: row.open?.expectedReturnAt?.toISOString() ?? null,
          periodBorrowCount: row.periodBorrowCount,
          periodReturnCount: row.periodReturnCount,
          openIsOverdue: isOutNow && (row.open?.isOverdue ?? false),
        };
      }),
      byEmployee: agg.employeeRows.map((row) => ({
        employeeId: row.employeeId,
        displayName: row.displayName,
        employeeCode: row.employeeCode,
        openInstrumentCount: row.openInstrumentCount,
        periodBorrowCount: row.periodBorrowCount,
        periodReturnCount: row.periodReturnCount,
      })),
    };
  }
}
