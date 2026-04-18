import { describe, expect, it } from 'vitest';
import { MeasuringInstrumentLoanAnalyticsRepository } from '../measuring-instrument-loan-analytics.repository.js';

describe('measuring monthly anchor regression', () => {
  it('anchors monthly trend to periodTo month', async () => {
    const repository = new MeasuringInstrumentLoanAnalyticsRepository({
      measuringInstrumentLoanEvent: {
        findMany: async () => [],
      },
      measuringInstrument: {
        findMany: async () => [],
      },
      employee: {
        findMany: async () => [],
      },
      loan: {
        findMany: async () => [],
      },
    } as never);

    const result = await repository.loadAggregate({
      periodFrom: new Date('2024-01-01T00:00:00.000Z'),
      periodTo: new Date('2024-01-31T23:59:59.999Z'),
      monthlyMonths: 3,
      timeZone: 'UTC',
      now: new Date('2026-04-18T00:00:00.000Z'),
    });

    expect(result.monthlyTrend.map((v) => v.yearMonth)).toEqual(['2023-11', '2023-12', '2024-01']);
  });

  it('uses timezone month at boundary for Asia/Tokyo', async () => {
    const repository = new MeasuringInstrumentLoanAnalyticsRepository({
      measuringInstrumentLoanEvent: {
        findMany: async () => [],
      },
      measuringInstrument: {
        findMany: async () => [],
      },
      employee: {
        findMany: async () => [],
      },
      loan: {
        findMany: async () => [],
      },
    } as never);

    const result = await repository.loadAggregate({
      periodFrom: new Date('2024-01-01T00:00:00.000Z'),
      periodTo: new Date('2024-01-31T15:00:00.000Z'),
      monthlyMonths: 1,
      timeZone: 'Asia/Tokyo',
      now: new Date('2026-04-18T00:00:00.000Z'),
    });

    expect(result.monthlyTrend.map((v) => v.yearMonth)).toEqual(['2024-02']);
  });
});
