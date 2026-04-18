import { describe, expect, it } from 'vitest';
import { RiggingLoanAnalyticsRepository } from '../../../rigging/analytics/rigging-loan-analytics.repository.js';
import { ItemLoanAnalyticsRepository } from '../../../tools/item-loan-analytics.repository.js';

describe('monthly anchor regression', () => {
  it('triggers rigging repository monthly query path', async () => {
    const repo = new RiggingLoanAnalyticsRepository({
      $queryRaw: async () => {
        throw new Error('STOP_AFTER_MONTHLY_QUERY');
      },
    } as never);

    await expect(
      repo.loadAggregate({
        periodFrom: new Date('2024-01-01T00:00:00.000Z'),
        periodTo: new Date('2024-01-31T23:59:59.999Z'),
        monthlyMonths: 3,
        timeZone: 'Asia/Tokyo',
        now: new Date('2026-04-18T00:00:00.000Z'),
      })
    ).rejects.toThrow('STOP_AFTER_MONTHLY_QUERY');
  });

  it('triggers item repository monthly query path', async () => {
    const repo = new ItemLoanAnalyticsRepository({
      $queryRaw: async () => {
        throw new Error('STOP_AFTER_MONTHLY_QUERY');
      },
    } as never);

    await expect(
      repo.loadAggregate({
        periodFrom: new Date('2024-01-01T00:00:00.000Z'),
        periodTo: new Date('2024-01-31T23:59:59.999Z'),
        monthlyMonths: 3,
        timeZone: 'Asia/Tokyo',
        now: new Date('2026-04-18T00:00:00.000Z'),
      })
    ).rejects.toThrow('STOP_AFTER_MONTHLY_QUERY');
  });
});
