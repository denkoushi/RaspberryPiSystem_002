import { describe, expect, it } from 'vitest';

import { shouldReplaceActualHoursWinner } from '../actual-hours/actual-hours-winner-policy.js';

describe('actual-hours-winner-policy', () => {
  it('rawUpdatedAtが新しい候補をwinnerにする', () => {
    const current = {
      rawId: 'raw-1',
      explicitUpdatedAt: null,
      workDate: new Date('2024-12-01T00:00:00.000Z'),
      rawUpdatedAt: new Date('2024-12-02T00:00:00.000Z'),
      rawCreatedAt: new Date('2024-12-02T00:00:00.000Z'),
    };
    const candidate = {
      rawId: 'raw-2',
      explicitUpdatedAt: null,
      workDate: new Date('2024-12-01T00:00:00.000Z'),
      rawUpdatedAt: new Date('2024-12-03T00:00:00.000Z'),
      rawCreatedAt: new Date('2024-12-03T00:00:00.000Z'),
    };

    expect(shouldReplaceActualHoursWinner(candidate, current)).toBe(true);
  });
});
