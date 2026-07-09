import { describe, expect, it } from 'vitest';

import { digitsOf, matchesDigitQuery } from '../inspectionDrawingDigitQuery';

describe('inspectionDrawingDigitQuery', () => {
  it('extracts digits only', () => {
    expect(digitsOf('7161-A')).toBe('7161');
    expect(digitsOf('M12-BASE')).toBe('12');
    expect(digitsOf('ABC')).toBe('');
    expect(digitsOf(null)).toBe('');
  });

  it('matches with progressive digit includes', () => {
    expect(matchesDigitQuery('7161-A', '')).toBe(true);
    expect(matchesDigitQuery('7161-A', '7')).toBe(true);
    expect(matchesDigitQuery('7161-A', '71')).toBe(true);
    expect(matchesDigitQuery('7161-A', '7161')).toBe(true);
    expect(matchesDigitQuery('7161-A', '7162')).toBe(false);
    expect(matchesDigitQuery('M12-BASE', '12')).toBe(true);
    expect(matchesDigitQuery('8100', '7')).toBe(false);
  });
});
