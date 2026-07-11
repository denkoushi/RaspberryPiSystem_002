import { describe, expect, it } from 'vitest';

import { resolveStatus } from '../shared.js';

describe('resolveStatus', () => {
  it('returns completed when completedAt is set', () => {
    expect(
      resolveStatus({
        completedEntryCount: 0,
        hasAnyLotEntry: false,
        completedAt: new Date('2026-07-10T00:00:00.000Z')
      })
    ).toBe('completed');
  });

  it('returns not_started when there are no lot entries', () => {
    expect(
      resolveStatus({
        completedEntryCount: 0,
        hasAnyLotEntry: false,
        completedAt: null
      })
    ).toBe('not_started');
  });

  it('returns in_progress for draft-only sessions (confirmed count 0)', () => {
    expect(
      resolveStatus({
        completedEntryCount: 0,
        hasAnyLotEntry: true,
        completedAt: null
      })
    ).toBe('in_progress');
  });

  it('returns in_progress when confirmed entries exist without pending review', () => {
    expect(
      resolveStatus({
        completedEntryCount: 1,
        hasAnyLotEntry: true,
        completedAt: null,
        pendingReviewCount: 0
      })
    ).toBe('in_progress');
  });
});
