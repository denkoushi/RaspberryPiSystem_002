import { describe, expect, it } from 'vitest';

import { formatDueDate, formatDueDateForProgressOverview } from './formatDueDate';

describe('formatDueDate', () => {
  it('formats YYYY-MM-DD to M/D(weekday) without year', () => {
    expect(formatDueDate('2026-02-01')).toBe('2/1(日)');
  });

  it('returns empty string for empty or invalid input', () => {
    expect(formatDueDate('')).toBe('');
    expect(formatDueDate(null)).toBe('');
    expect(formatDueDate('invalid')).toBe('');
  });
});

describe('formatDueDateForProgressOverview', () => {
  it('formats to MM/DD_weekday with zero padding and underscore before weekday', () => {
    expect(formatDueDateForProgressOverview('2026-02-01')).toBe('02/01_日');
    expect(formatDueDateForProgressOverview('2026-12-31')).toBe('12/31_木');
  });

  it('matches formatDueDate empty / invalid behavior', () => {
    expect(formatDueDateForProgressOverview('')).toBe('');
    expect(formatDueDateForProgressOverview(null)).toBe('');
    expect(formatDueDateForProgressOverview('invalid')).toBe('');
  });
});
