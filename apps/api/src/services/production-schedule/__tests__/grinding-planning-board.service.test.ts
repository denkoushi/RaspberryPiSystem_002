import { describe, expect, it } from 'vitest';

import { dateValue, resolvePlanningBoardDueRequest } from '../grinding-planning-board.service.js';

describe('grinding planning board timestamp parsing', () => {
  it('treats timezone-free PostgreSQL JSON timestamps as UTC', () => {
    expect(dateValue('2026-09-09T00:00:00.000')?.toISOString()).toBe('2026-09-09T00:00:00.000Z');
    expect(dateValue('2026-09-09 00:00:00')?.toISOString()).toBe('2026-09-09T00:00:00.000Z');
  });

  it('preserves explicit offsets and accepts date-only due values', () => {
    expect(dateValue('2026-09-09T00:00:00+09:00')?.toISOString()).toBe('2026-09-08T15:00:00.000Z');
    expect(dateValue('2026-09-09')?.toISOString()).toBe('2026-09-09T00:00:00.000Z');
  });

  it('returns null for empty and invalid values', () => {
    expect(dateValue('')).toBeNull();
    expect(dateValue('not-a-date')).toBeNull();
  });
});

describe('grinding planning board due requests', () => {
  it('adds calendar days from effective then original due date', () => {
    const result = resolvePlanningBoardDueRequest({
      request: { kind: 'offsetDays', days: 2 },
      currentEffectiveDueDate: '2026-02-27',
      originalDueDate: '2026-02-20'
    });
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('supports leap day and restore without weekday rules', () => {
    const result = resolvePlanningBoardDueRequest({
      request: { kind: 'offsetDays', days: 1 },
      currentEffectiveDueDate: '2028-02-28',
      originalDueDate: null
    });
    expect(result?.toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(resolvePlanningBoardDueRequest({
      request: { kind: 'restore' },
      currentEffectiveDueDate: '2028-02-29',
      originalDueDate: '2028-02-28'
    })).toBeNull();
  });

  it('returns undefined for same exact date and rejects an earlier known due date', () => {
    expect(resolvePlanningBoardDueRequest({
      request: { kind: 'date', date: '2026-09-01' },
      currentEffectiveDueDate: '2026-09-01',
      originalDueDate: '2026-08-01'
    })).toBeUndefined();
    expect(() => resolvePlanningBoardDueRequest({
      request: { kind: 'date', date: '2026-09-05' },
      currentEffectiveDueDate: '2026-09-10',
      originalDueDate: '2026-09-01'
    })).toThrowError();
  });

  it('uses the original date or JST today for offsets and validates date inputs', () => {
    const fromOriginal = resolvePlanningBoardDueRequest({
      request: { kind: 'offsetDays', days: 2 },
      currentEffectiveDueDate: null,
      originalDueDate: '2026-12-30'
    });
    expect(fromOriginal?.toISOString().slice(0, 10)).toBe('2027-01-01');

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const fromToday = resolvePlanningBoardDueRequest({
      request: { kind: 'offsetDays', days: 1 },
      currentEffectiveDueDate: null,
      originalDueDate: null
    });
    expect(fromToday?.toISOString().slice(0, 10)).toBe(tomorrow.toISOString().slice(0, 10));

    expect(() => resolvePlanningBoardDueRequest({
      request: { kind: 'offsetDays', days: 0 },
      currentEffectiveDueDate: null,
      originalDueDate: null
    })).toThrowError();
    expect(() => resolvePlanningBoardDueRequest({
      request: { kind: 'date', date: '2026-02-30' },
      currentEffectiveDueDate: null,
      originalDueDate: null
    })).toThrowError();
  });
});
