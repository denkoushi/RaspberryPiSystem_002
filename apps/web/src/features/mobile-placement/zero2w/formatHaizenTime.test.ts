import { describe, expect, it } from 'vitest';

import { formatHaizenTime } from './formatHaizenTime';

const now = new Date(2026, 9, 16, 12, 0).getTime();

describe('formatHaizenTime', () => {
  it.each([0, 1, 59])('formats %i minutes ago relatively', (minutes) => {
    expect(formatHaizenTime(new Date(now - minutes * 60_000).toISOString(), now)).toBe(`${minutes}分前`);
  });
  it('switches to HH:MM at exactly 60 minutes', () => {
    expect(formatHaizenTime(new Date(now - 60 * 60_000).toISOString(), now)).toBe('11:00');
    expect(formatHaizenTime(new Date(2026, 9, 16, 9, 5).toISOString(), now)).toBe('09:05');
  });
  it('clamps clock skew and handles invalid timestamps', () => {
    expect(formatHaizenTime(new Date(now + 60_000).toISOString(), now)).toBe('0分前');
    expect(formatHaizenTime('invalid', now)).toBe('—');
  });
});
