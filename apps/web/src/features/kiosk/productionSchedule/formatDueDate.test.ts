import { describe, expect, it } from 'vitest';

import { formatDueDate } from './formatDueDate';

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
