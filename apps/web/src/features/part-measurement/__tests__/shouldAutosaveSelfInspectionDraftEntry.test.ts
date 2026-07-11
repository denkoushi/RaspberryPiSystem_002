import { describe, expect, it } from 'vitest';

import { shouldAutosaveSelfInspectionDraftEntry } from '../shouldAutosaveSelfInspectionDraftEntry';

describe('shouldAutosaveSelfInspectionDraftEntry', () => {
  it('skips confirmed entries', () => {
    expect(shouldAutosaveSelfInspectionDraftEntry('confirmed')).toBe(false);
  });

  it('allows draft and missing status', () => {
    expect(shouldAutosaveSelfInspectionDraftEntry('draft')).toBe(true);
    expect(shouldAutosaveSelfInspectionDraftEntry(undefined)).toBe(true);
    expect(shouldAutosaveSelfInspectionDraftEntry(null)).toBe(true);
  });
});
