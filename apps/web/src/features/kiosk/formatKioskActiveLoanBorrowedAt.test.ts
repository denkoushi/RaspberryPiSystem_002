import { describe, expect, it } from 'vitest';

import { formatKioskActiveLoanBorrowedAt } from './formatKioskActiveLoanBorrowedAt';

describe('formatKioskActiveLoanBorrowedAt', () => {
  it('returns fallback for Invalid Date', () => {
    expect(formatKioskActiveLoanBorrowedAt(new Date(Number.NaN))).toBe('—');
  });

  it('has no seconds segment and uses 24h style (no 午前/午後)', () => {
    const out = formatKioskActiveLoanBorrowedAt(new Date('2026-04-05T06:30:00.000Z'));
    expect(out).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(out).not.toMatch(/午前|午後/);
    expect(out).toContain('2026');
  });

  it('formats a known instant in Asia/Tokyo (minute precision, tolerant separators)', () => {
    const out = formatKioskActiveLoanBorrowedAt(new Date('2026-03-24T08:22:31.000Z'));
    // Allow ASCII vs fullwidth slashes (ja-JP ICU differences across environments)
    expect(out).toMatch(/^2026(?:\/|／)03(?:\/|／)24\s+17:22$/);
  });
});
