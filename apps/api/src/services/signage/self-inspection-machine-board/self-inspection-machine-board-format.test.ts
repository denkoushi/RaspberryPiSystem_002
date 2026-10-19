import { describe, expect, it } from 'vitest';

import { formatUpdatedAt } from './self-inspection-machine-board-format.js';

describe('formatUpdatedAt', () => {
  it('formats a UTC boundary and rolls the date over in Asia/Tokyo', () => {
    expect(formatUpdatedAt(new Date('2026-06-30T14:59:00.000Z'))).toBe('2026/06/30 23:59');
    expect(formatUpdatedAt(new Date('2026-06-30T15:00:00.000Z'))).toBe('2026/07/01 00:00');
  });

  it('does not depend on the API process timezone', () => {
    const originalTimezone = process.env.TZ;
    const instant = new Date('2026-01-01T15:04:05.000Z');

    try {
      for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = timezone;
        expect(formatUpdatedAt(instant)).toBe('2026/01/02 00:04');
      }
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
