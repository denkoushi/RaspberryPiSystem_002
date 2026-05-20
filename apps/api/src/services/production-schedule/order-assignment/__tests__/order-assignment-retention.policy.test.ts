import { describe, expect, it } from 'vitest';

import {
  shouldReleaseOrderAssignment,
  shouldRetainOrderAssignment,
} from '../order-assignment-retention.policy.js';

describe('order-assignment-retention.policy', () => {
  it('retains incomplete list-visible rows (S/R)', () => {
    expect(shouldRetainOrderAssignment({ effectiveCompleted: false, listVisible: true })).toBe(true);
    expect(shouldReleaseOrderAssignment({ effectiveCompleted: false, listVisible: true })).toBe(false);
  });

  it('releases externally completed rows even when list-visible (A)', () => {
    expect(shouldRetainOrderAssignment({ effectiveCompleted: true, listVisible: true })).toBe(false);
    expect(shouldReleaseOrderAssignment({ effectiveCompleted: true, listVisible: true })).toBe(true);
  });

  it('releases list-invisible incomplete rows (alpha)', () => {
    expect(shouldRetainOrderAssignment({ effectiveCompleted: false, listVisible: false })).toBe(false);
    expect(shouldReleaseOrderAssignment({ effectiveCompleted: false, listVisible: false })).toBe(true);
  });
});
