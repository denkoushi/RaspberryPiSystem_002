import type { DataSource } from '../data-source.interface.js';
import type { KpiVisualizationData, SeriesVisualizationData, VisualizationData } from '../../visualization.types.js';
import { prisma } from '../../../../lib/prisma.js';

const DEFAULT_PERIOD_DAYS = 7;
const MAX_PERIOD_DAYS = 90;
const DEFAULT_TOP_N = 5;
const MAX_TOP_N = 20;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export class MeasuringInstrumentsDataSource implements DataSource {
  readonly type = 'measuring_instruments';

  async fetchData(config: Record<string, unknown>): Promise<VisualizationData> {
    const metric = typeof config.metric === 'string' ? config.metric : 'usage_top';
    const periodDaysRaw = parseNumber(config.periodDays, DEFAULT_PERIOD_DAYS);
    const periodDays = clampNumber(periodDaysRaw, 1, MAX_PERIOD_DAYS);

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - periodDays);

    if (metric === 'return_rate') {
      return await this.fetchReturnRate(startDate, now);
    }

    return await this.fetchUsageTop(startDate, parseNumber(config.topN, DEFAULT_TOP_N));
  }

  private async fetchUsageTop(startDate: Date, topNRaw: number): Promise<SeriesVisualizationData> {
    const topN = clampNumber(topNRaw, 1, MAX_TOP_N);

    const usage = await prisma.loan.groupBy({
      by: ['measuringInstrumentId'],
      where: {
        measuringInstrumentId: { not: null },
        borrowedAt: { gte: startDate },
        cancelledAt: null,
      },
      _count: true,
      orderBy: { _count: { measuringInstrumentId: 'desc' } },
      take: topN,
    });

    const ids = usage
      .map((row) => row.measuringInstrumentId)
      .filter((id): id is string => typeof id === 'string');

    const instruments = ids.length
      ? await prisma.measuringInstrument.findMany({
          where: { id: { in: ids } },
          select: { id: true, managementNumber: true, name: true },
        })
      : [];

    const instrumentMap = new Map(instruments.map((instrument) => [instrument.id, instrument]));

    const labels = usage.map((row) => {
      const instrument = row.measuringInstrumentId ? instrumentMap.get(row.measuringInstrumentId) : null;
      if (!instrument) {
        return row.measuringInstrumentId ?? '未設定';
      }
      const parts = [instrument.managementNumber, instrument.name].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : instrument.id;
    });

    const values = usage.map((row) => row._count ?? 0);

    return {
      kind: 'series',
      labels,
      datasets: [
        {
          label: '使用回数',
          values,
        },
      ],
    };
  }

  private async fetchReturnRate(startDate: Date, now: Date): Promise<KpiVisualizationData> {
    const loans = await prisma.loan.findMany({
      where: {
        measuringInstrumentId: { not: null },
        borrowedAt: { gte: startDate },
        cancelledAt: null,
        dueAt: { not: null },
      },
      select: { dueAt: true, returnedAt: true },
    });

    let onTime = 0;
    let overdue = 0;
    let outstanding = 0;

    for (const loan of loans) {
      if (!loan.dueAt) {
        continue;
      }
      if (loan.returnedAt) {
        if (loan.returnedAt <= loan.dueAt) {
          onTime += 1;
        } else {
          overdue += 1;
        }
      } else if (loan.dueAt < now) {
        overdue += 1;
      } else {
        outstanding += 1;
      }
    }

    const total = onTime + overdue + outstanding;
    const toRate = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

    return {
      kind: 'kpi',
      items: [
        {
          label: '期限内返却率',
          value: toRate(onTime),
          unit: '%',
          isGood: true,
          note: `${onTime}/${total}`,
        },
        {
          label: '期限超過率',
          value: toRate(overdue),
          unit: '%',
          isGood: false,
          note: `${overdue}/${total}`,
        },
        {
          label: '未返却',
          value: outstanding,
          unit: '件',
          isGood: false,
          note: total > 0 ? `${outstanding}/${total}` : undefined,
        },
      ],
    };
  }
}
