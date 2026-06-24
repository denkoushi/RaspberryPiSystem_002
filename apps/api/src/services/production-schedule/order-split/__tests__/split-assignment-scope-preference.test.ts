import { describe, expect, it } from 'vitest';

import { pickPreferredScopedLocationAssignment } from '../split-assignment-scope-preference.js';

describe('pickPreferredScopedLocationAssignment', () => {
  it('prefers exact location over site fallback even when fallback is newer', () => {
    const picked = pickPreferredScopedLocationAssignment(
      [
        {
          location: '第2工場',
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
          orderNumber: 1
        },
        {
          location: '第2工場 - kioskA',
          updatedAt: new Date('2026-05-01T00:00:00.000Z'),
          orderNumber: 2
        }
      ],
      '第2工場 - kioskA'
    );

    expect(picked?.orderNumber).toBe(2);
  });
});
