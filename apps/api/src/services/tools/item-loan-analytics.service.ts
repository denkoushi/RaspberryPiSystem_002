import type { ItemLoanAnalyticsResponse } from '@raspi-system/shared-types';
import { ApiError } from '../../lib/errors.js';
import { ItemLoanAnalyticsRepository } from './item-loan-analytics.repository.js';
import type {
  IItemLoanAnalyticsRepository,
  ItemLoanAnalyticsQueryInput,
  ItemLoanAnalyticsTimeZone
} from './item-loan-analytics.types.js';

const DEFAULT_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_MONTHS = 6;

export type ItemLoanAnalyticsPublicQuery = {
  periodFrom?: Date;
  periodTo?: Date;
  monthlyMonths?: number;
  timeZone?: ItemLoanAnalyticsTimeZone;
  /** 写真持出集計の仮想行 ID（`pt-` + sha256 先頭24hex） */
  itemId?: string;
};

export class ItemLoanAnalyticsService {
  constructor(private readonly repository: IItemLoanAnalyticsRepository) {}

  static createDefault(): ItemLoanAnalyticsService {
    return new ItemLoanAnalyticsService(new ItemLoanAnalyticsRepository());
  }

  async getDashboard(query: ItemLoanAnalyticsPublicQuery): Promise<ItemLoanAnalyticsResponse> {
    const now = new Date();
    const periodTo = query.periodTo ?? now;
    const periodFrom = query.periodFrom ?? new Date(periodTo.getTime() - DEFAULT_RANGE_MS);
    if (periodFrom.getTime() > periodTo.getTime()) {
      throw new ApiError(400, 'periodFrom は periodTo 以前である必要があります');
    }

    const monthlyMonths = Math.min(24, Math.max(1, query.monthlyMonths ?? DEFAULT_MONTHS));
    const timeZone: ItemLoanAnalyticsTimeZone = query.timeZone ?? 'Asia/Tokyo';

    let toolLabelFilter: string | undefined;
    if (query.itemId) {
      const label = await this.repository.resolveSyntheticItemIdToToolLabel(query.itemId);
      if (label === null) {
        throw new ApiError(404, '指定の持出返却アイテムが見つかりません');
      }
      toolLabelFilter = label;
    }

    const input: ItemLoanAnalyticsQueryInput = {
      periodFrom,
      periodTo,
      monthlyMonths,
      timeZone,
      now,
      toolLabelFilter,
    };

    const agg = await this.repository.loadAggregate(input);

    const statusMap = (s: string): ItemLoanAnalyticsResponse['byItem'][0]['status'] => {
      if (s === 'AVAILABLE' || s === 'IN_USE' || s === 'MAINTENANCE' || s === 'RETIRED') return s;
      return 'AVAILABLE';
    };

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
        totalItemsActive: agg.totalItemsActive,
        periodBorrowCount: agg.periodBorrowCount,
        periodReturnCount: agg.periodReturnCount
      },
      monthlyTrend: agg.monthlyTrend,
      byItem: agg.itemRows.map((row) => {
        const isOutNow = row.open !== null;
        return {
          itemId: row.itemId,
          itemCode: row.itemCode,
          name: row.name,
          status: statusMap(row.status),
          isOutNow,
          currentBorrowerDisplayName: row.open?.employeeDisplayName ?? null,
          dueAt: row.open?.dueAt?.toISOString() ?? null,
          periodBorrowCount: row.periodBorrowCount,
          periodReturnCount: row.periodReturnCount,
          openIsOverdue: isOutNow && (row.open?.isOverdue ?? false)
        };
      }),
      periodEvents: agg.periodEventRows.map((event) => ({
        kind: event.kind,
        eventAt: event.eventAt.toISOString(),
        assetId: event.assetId,
        assetLabel: event.assetLabel,
        actorDisplayName: event.actorDisplayName,
        actorEmployeeId: event.actorEmployeeId
      })),
      byEmployee: agg.employeeRows.map((row) => ({
        employeeId: row.employeeId,
        displayName: row.displayName,
        employeeCode: row.employeeCode,
        openItemCount: row.openItemCount,
        overdueOpenItemCount: row.overdueOpenItemCount,
        periodBorrowCount: row.periodBorrowCount,
        periodReturnCount: row.periodReturnCount
      }))
    };
  }
}
