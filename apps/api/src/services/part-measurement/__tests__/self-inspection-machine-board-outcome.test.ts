import { describe, expect, it } from 'vitest';

import {
  resolveSelfInspectionMachineBoardOutcome,
} from '../self-inspection-machine-board-outcome.js';

describe('resolveSelfInspectionMachineBoardOutcome', () => {
  it('applies rejected/direct FAIL before every other state', () => {
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 2,
        requiredEntryCount: 2,
        directFailCount: 1,
        pendingReviewCount: 1,
      })
    ).toBe('rejected');
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 2,
        requiredEntryCount: 2,
        judgementResults: ['FAIL'],
      })
    ).toBe('rejected');
  });

  it('treats PENDING as pending, but APPROVED as pass-eligible', () => {
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 2,
        requiredEntryCount: 2,
        reviewStatuses: ['PENDING'],
      })
    ).toBe('pending');
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 2,
        requiredEntryCount: 2,
        reviewStatuses: ['PENDING'],
        finalReviewStatuses: ['APPROVED'],
      })
    ).toBe('pass');
  });

  it('keeps another measurement value pending when one value is APPROVED', () => {
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 2,
        requiredEntryCount: 2,
        measurementOutcomes: [
          { reviewStatus: 'PENDING', finalReviewStatus: null },
          { reviewStatus: 'PENDING', finalReviewStatus: 'APPROVED' },
        ],
      })
    ).toBe('pending');
  });

  it('resolves in-progress, pass, and not-started in order', () => {
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 1,
        requiredEntryCount: 2,
      })
    ).toBe('in_progress');
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 2,
        requiredEntryCount: 2,
      })
    ).toBe('pass');
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 0,
        requiredEntryCount: 2,
        hasAnyLotEntry: true,
      })
    ).toBe('in_progress');
    expect(
      resolveSelfInspectionMachineBoardOutcome({
        confirmedEntryCount: 0,
        requiredEntryCount: 2,
      })
    ).toBe('not_started');
  });
});
