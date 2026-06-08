import { describe, expect, it } from 'vitest';

import { pickSessionForScheduleRow } from '../self-inspection.service.js';

describe('pickSessionForScheduleRow', () => {
  it('prefers incomplete sessions over completed ones', () => {
    const completed = {
      scheduleRowId: 'row-1',
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    const inProgress = {
      scheduleRowId: 'row-1',
      completedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    expect(pickSessionForScheduleRow([completed, inProgress], 'row-1')).toBe(inProgress);
  });

  it('prefers the most recently updated session among same completion status', () => {
    const older = {
      scheduleRowId: 'row-1',
      completedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const newer = {
      scheduleRowId: 'row-1',
      completedAt: null,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    expect(pickSessionForScheduleRow([older, newer], 'row-1')).toBe(newer);
  });
});
