import { describe, expect, it } from 'vitest';
import { compactLayoutHasThumbnail, resolveCompactThumbPlan } from './compact-thumb-plan.js';
import type { LoanCardViewModel } from './loan-card-grid.dto.js';

function baseView(over: Partial<LoanCardViewModel>): LoanCardViewModel {
  return {
    primaryText: 'P',
    employeeName: 'e',
    clientLocation: 'loc',
    borrowedDatePart: '',
    borrowedTimePart: '',
    borrowedCompact: '',
    isInstrument: false,
    isRigging: false,
    managementText: 'M1',
    riggingIdNumText: '',
    isExceeded: false,
    thumbnailDataUrl: null,
    ...over,
  };
}

describe('resolveCompactThumbPlan', () => {
  it('uses image when thumbnail embedded', () => {
    const v = baseView({ thumbnailDataUrl: 'data:image/png;base64,xx' });
    expect(resolveCompactThumbPlan(v)).toEqual({ kind: 'image', dataUrl: v.thumbnailDataUrl! });
    expect(compactLayoutHasThumbnail(resolveCompactThumbPlan(v))).toBe(true);
  });

  it('hides column for kiosk body without image (instrument/rigging)', () => {
    const v = baseView({
      isInstrument: true,
      compactKioskLines: { headLine: 'MI-1', nameLine: 'caliper' },
    });
    expect(resolveCompactThumbPlan(v)).toEqual({ kind: 'hidden' });
    expect(compactLayoutHasThumbnail(resolveCompactThumbPlan(v))).toBe(false);
  });

  it('reserves empty slot for plain item without image (legacy)', () => {
    const v = baseView({ isInstrument: false, isRigging: false });
    expect(resolveCompactThumbPlan(v)).toEqual({ kind: 'itemEmptySlot' });
    expect(compactLayoutHasThumbnail(resolveCompactThumbPlan(v))).toBe(false);
  });
});
