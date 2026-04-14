import type { RiggingLoanAnalyticsResponse } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { RiggingLoanAnalyticsRepository } from './rigging-loan-analytics.repository.js';
import type {
  IRiggingLoanAnalyticsRepository,
  RiggingLoanAnalyticsQueryInput,
  RiggingLoanAnalyticsTimeZone
} from './rigging-loan-analytics.types.js';

const DEFAULT_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_MONTHS = 6;

export type RiggingLoanAnalyticsPublicQuery = {
  periodFrom?: Date;
  periodTo?: Date;
  monthlyMonths?: number;
  timeZone?: RiggingLoanAnalyticsTimeZone;
  riggingGearId?: string;
};

/**
 * 吊具の持出・返却ダッシュ用の集計。HTTP 層は持たず、入力の正規化と応答 DTO の組み立てのみ。
 */
export class RiggingLoanAnalyticsService {
  constructor(private readonly repository: IRiggingLoanAnalyticsRepository) {}

  static createDefault(): RiggingLoanAnalyticsService {
    return new RiggingLoanAnalyticsService(new RiggingLoanAnalyticsRepository());
  }

  async getDashboard(query: RiggingLoanAnalyticsPublicQuery): Promise<RiggingLoanAnalyticsResponse> {
    const now = new Date();
    const periodTo = query.periodTo ?? now;
    const periodFrom = query.periodFrom ?? new Date(periodTo.getTime() - DEFAULT_RANGE_MS);
    if (periodFrom.getTime() > periodTo.getTime()) {
      throw new ApiError(400, 'periodFrom は periodTo 以前である必要があります');
    }

    const monthlyMonths = Math.min(24, Math.max(1, query.monthlyMonths ?? DEFAULT_MONTHS));
    const timeZone: RiggingLoanAnalyticsTimeZone = query.timeZone ?? 'Asia/Tokyo';

    if (query.riggingGearId) {
      const gear = await prisma.riggingGear.findUnique({ where: { id: query.riggingGearId } });
      if (!gear) {
        throw new ApiError(404, '吊具が見つかりません');
      }
    }

    const input: RiggingLoanAnalyticsQueryInput = {
      periodFrom,
      periodTo,
      monthlyMonths,
      timeZone,
      now,
      riggingGearId: query.riggingGearId,
    };

    const agg = await this.repository.loadAggregate(input);

    return {
      meta: {
        timeZone,
        periodFrom: periodFrom.toISOString(),
        periodTo: periodTo.toISOString(),
        monthlyMonths,
        generatedAt: now.toISOString()
      },
      summary: {
        openLoanCount: agg.openLoanCount,
        overdueOpenCount: agg.overdueOpenCount,
        totalRiggingGearsActive: agg.totalRiggingGearsActive,
        periodBorrowCount: agg.periodBorrowCount,
        periodReturnCount: agg.periodReturnCount
      },
      monthlyTrend: agg.monthlyTrend,
      byGear: agg.gearRows.map((row) => {
        const isOutNow = row.open !== null;
        return {
          gearId: row.gearId,
          managementNumber: row.managementNumber,
          name: row.name,
          status: row.status,
          isOutNow,
          currentBorrowerDisplayName: row.open?.employeeDisplayName ?? null,
          dueAt: row.open?.dueAt?.toISOString() ?? null,
          periodBorrowCount: row.periodBorrowCount,
          periodReturnCount: row.periodReturnCount,
          openIsOverdue: isOutNow && (row.open?.isOverdue ?? false)
        };
      }),
      byEmployee: agg.employeeRows.map((row) => ({
        employeeId: row.employeeId,
        displayName: row.displayName,
        employeeCode: row.employeeCode,
        openRiggingCount: row.openRiggingCount,
        periodBorrowCount: row.periodBorrowCount,
        periodReturnCount: row.periodReturnCount
      }))
    };
  }
}
