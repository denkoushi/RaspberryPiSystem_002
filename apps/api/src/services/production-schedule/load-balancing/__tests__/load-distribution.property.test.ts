import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distributeRowLoadEvenly } from '../load-distribution.js';

const dayMs = 86400000;
const dateAt = (offset: number) => new Date(Date.UTC(2025, 0, 1) + offset * dayMs);
const offset = fc.integer({ min: 0, max: 730 });
const positiveMinutes = fc.integer({ min: 1, max: 10000000 }).map((n) => n / 100);
const mode = fc.constantFrom('weekdays' as const, 'calendar_days' as const);
const distribute = (start: Date, end: Date, totalMinutes: number, workCalendarMode: 'weekdays' | 'calendar_days') =>
  distributeRowLoadEvenly({ row: { rowId: 'row', resourceCd: '021', totalMinutes,
    plannedStartDate: start, effectiveDueDate: end }, workCalendarMode });

describe('distributeRowLoadEvenly properties', () => {
  it('conserves positive load and distributes equally on every active day within the period', () => {
    fc.assert(fc.property(offset, fc.integer({ min: 0, max: 90 }), positiveMinutes, mode,
      (startOffset, duration, total, calendar) => {
        const start = dateAt(startOffset);
        const end = dateAt(startOffset + duration);
        // Independent calendar oracle also covers periods with no active days.
        const expected = Array.from({ length: duration + 1 }, (_, i) => dateAt(startOffset + i))
          .filter((date) => calendar === 'calendar_days' || (date.getUTCDay() > 0 && date.getUTCDay() < 6))
          .map((date) => date.toISOString().slice(0, 10));
        const allocations = distribute(start, end, total, calendar);
        expect(allocations.map((a) => a.dateKey)).toEqual(expected);
        if (expected.length === 0) {
          expect(allocations).toEqual([]);
          return;
        }
        const sum = allocations.reduce((value, a) => value + a.minutes, 0);
        expect(Math.abs(sum - total)).toBeLessThanOrEqual(1e-9 * Math.max(1, total));
        for (const allocation of allocations) {
          expect(allocation.minutes).toBeCloseTo(total / expected.length, 8);
          expect(allocation.resourceCd).toBe('021');
          expect(allocation.yearMonth).toBe(allocation.dateKey.slice(0, 7));
        }
      }), { numRuns: 1000 });
  });

  it('returns no allocations for non-positive load or reversed periods', () => {
    fc.assert(fc.property(offset, fc.integer({ min: 1, max: 90 }), positiveMinutes, mode,
      (start, duration, total, calendar) => {
        expect(distribute(dateAt(start), dateAt(start + duration), 0, calendar)).toEqual([]);
        expect(distribute(dateAt(start), dateAt(start + duration), -total, calendar)).toEqual([]);
        expect(distribute(dateAt(start + duration), dateAt(start), total, calendar)).toEqual([]);
      }), { numRuns: 1000 });
  });

  it('returns no allocations for weekend-only weekday periods', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 104 }), fc.boolean(), positiveMinutes, (week, includeSunday, total) => {
      const saturday = 3 + week * 7; // 2025-01-04
      expect(distribute(dateAt(saturday), dateAt(saturday + Number(includeSunday)), total, 'weekdays')).toEqual([]);
    }), { numRuns: 1000 });
  });
});
