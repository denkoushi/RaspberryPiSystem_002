import type {
  ItemLoanAnalyticsResponse,
  MeasuringInstrumentLoanAnalyticsResponse,
  RiggingLoanAnalyticsResponse,
} from '@raspi-system/shared-types';
import { ItemLoanAnalyticsService } from '../../tools/item-loan-analytics.service.js';
import { MeasuringInstrumentLoanAnalyticsService } from '../../measuring-instruments/analytics/measuring-instrument-loan-analytics.service.js';
import { RiggingLoanAnalyticsService } from '../../rigging/analytics/rigging-loan-analytics.service.js';
import type { MeasuringInstrumentLoanAnalyticsTimeZone } from '../../measuring-instruments/analytics/measuring-instrument-loan-analytics.types.js';
import type { RiggingLoanAnalyticsTimeZone } from '../../rigging/analytics/rigging-loan-analytics.types.js';
import type { ItemLoanAnalyticsTimeZone } from '../../tools/item-loan-analytics.types.js';
import type { LoanReportCategoryKey } from './loan-report.types.js';

export type LoanReportAggregateQuery = {
  category: LoanReportCategoryKey;
  periodFrom: Date;
  periodTo: Date;
  monthlyMonths: number;
  timeZone?: string;
  /** 計測機器 analytics の単体絞り込み */
  measuringInstrumentId?: string;
  riggingGearId?: string;
  itemId?: string;
};

export type LoanReportNormalizedAnalytics =
  | { kind: 'measuring'; response: MeasuringInstrumentLoanAnalyticsResponse }
  | { kind: 'rigging'; response: RiggingLoanAnalyticsResponse }
  | { kind: 'tools'; response: ItemLoanAnalyticsResponse };

/**
 * 3カテゴリの analytics サービスを束ね、正規化済みレスポンスを返す。
 */
export class LoanReportAggregateService {
  constructor(
    private readonly measuring = MeasuringInstrumentLoanAnalyticsService.createDefault(),
    private readonly rigging = RiggingLoanAnalyticsService.createDefault(),
    private readonly tools = ItemLoanAnalyticsService.createDefault()
  ) {}

  static createDefault(): LoanReportAggregateService {
    return new LoanReportAggregateService();
  }

  async loadNormalized(query: LoanReportAggregateQuery): Promise<LoanReportNormalizedAnalytics> {
    const tzRaw = query.timeZone ?? 'Asia/Tokyo';
    const asMeasuringTz = (t: string): MeasuringInstrumentLoanAnalyticsTimeZone => (t === 'UTC' ? 'UTC' : 'Asia/Tokyo');
    const asRiggingTz = (t: string): RiggingLoanAnalyticsTimeZone => (t === 'UTC' ? 'UTC' : 'Asia/Tokyo');
    const asItemTz = (t: string): ItemLoanAnalyticsTimeZone => (t === 'UTC' ? 'UTC' : 'Asia/Tokyo');
    const base = {
      periodFrom: query.periodFrom,
      periodTo: query.periodTo,
      monthlyMonths: query.monthlyMonths,
    };

    switch (query.category) {
      case 'measuring': {
        const response = await this.measuring.getDashboard({
          ...base,
          timeZone: asMeasuringTz(tzRaw),
          measuringInstrumentId: query.measuringInstrumentId,
        });
        return { kind: 'measuring', response };
      }
      case 'rigging': {
        const response = await this.rigging.getDashboard({
          ...base,
          timeZone: asRiggingTz(tzRaw),
          riggingGearId: query.riggingGearId,
        });
        return { kind: 'rigging', response };
      }
      case 'tools': {
        const response = await this.tools.getDashboard({
          ...base,
          timeZone: asItemTz(tzRaw),
          itemId: query.itemId,
        });
        return { kind: 'tools', response };
      }
    }
    throw new Error(`未対応のカテゴリです: ${String(query.category)}`);
  }
}
