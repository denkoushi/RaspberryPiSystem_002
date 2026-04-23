import { describe, expect, it } from 'vitest';
import { ACTIVE_BODY_FONT_SCALE, RETURNED_BODY_FONT_SCALE } from '../mi-instrument-display.types.js';
import { presentationForInstrumentKind } from '../mi-instrument-presentation.js';

describe('presentationForInstrumentKind', () => {
  it('maps active to two-line layout scale', () => {
    const p = presentationForInstrumentKind('active');
    expect(p.layoutMode).toBe('activeTwoLine');
    expect(p.bodyFontScale).toBe(ACTIVE_BODY_FONT_SCALE);
  });

  it('maps returned to one-line label scale', () => {
    const p = presentationForInstrumentKind('returned');
    expect(p.layoutMode).toBe('returnedOneLine');
    expect(p.bodyFontScale).toBe(RETURNED_BODY_FONT_SCALE);
  });
});
