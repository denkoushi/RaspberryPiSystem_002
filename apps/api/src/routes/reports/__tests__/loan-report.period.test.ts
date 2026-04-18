import { describe, expect, it } from 'vitest';
import { resolveLoanReportPeriod } from '../loan-report.js';

describe('resolveLoanReportPeriod', () => {
  it('date-only inputをAsia/Tokyo日付境界で終日範囲に正規化する', () => {
    const { periodFrom, periodTo } = resolveLoanReportPeriod({
      periodFrom: new Date('2026-04-18'),
      periodTo: new Date('2026-04-18'),
      timeZone: 'Asia/Tokyo',
    });

    expect(periodFrom.toISOString()).toBe('2026-04-17T15:00:00.000Z');
    expect(periodTo.toISOString()).toBe('2026-04-18T14:59:59.999Z');
    expect(periodTo.getTime() - periodFrom.getTime()).toBe(86_399_999);
  });

  it('明示時刻付き入力は変更しない', () => {
    const { periodFrom, periodTo } = resolveLoanReportPeriod({
      periodFrom: new Date('2026-04-18T08:30:00.000Z'),
      periodTo: new Date('2026-04-18T18:45:00.000Z'),
    });

    expect(periodFrom.toISOString()).toBe('2026-04-18T08:30:00.000Z');
    expect(periodTo.toISOString()).toBe('2026-04-18T18:45:00.000Z');
  });

  it('UTC指定時はUTC日付境界で終日範囲に正規化する', () => {
    const { periodFrom, periodTo } = resolveLoanReportPeriod({
      periodFrom: new Date('2026-04-18'),
      periodTo: new Date('2026-04-18'),
      timeZone: 'UTC',
    });

    expect(periodFrom.toISOString()).toBe('2026-04-18T00:00:00.000Z');
    expect(periodTo.toISOString()).toBe('2026-04-18T23:59:59.999Z');
  });
});
