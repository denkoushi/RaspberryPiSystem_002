import { describe, expect, it } from 'vitest';
import {
  COMPACT24_CARD_HEIGHT_PX,
  COMPACT24_HTML_CARD_PAD_PX,
  COMPACT24_HTML_NAME_MARGIN_BOTTOM_PX,
  COMPACT24_MAX_COLUMNS,
  COMPACT24_MAX_LINES_PRIMARY_OR_LOCATION,
  COMPACT24_MAX_ROWS,
  COMPACT24_SVG_CARD_PAD_PX,
} from './loan-card-contracts.js';

describe('loan-card-contracts', () => {
  it('defines splitCompact24 grid and text contracts', () => {
    expect(COMPACT24_MAX_COLUMNS).toBe(4);
    expect(COMPACT24_MAX_ROWS).toBe(6);
    expect(COMPACT24_CARD_HEIGHT_PX).toBe(164);
    expect(COMPACT24_HTML_CARD_PAD_PX).toBe(10);
    expect(COMPACT24_SVG_CARD_PAD_PX).toBe(12);
    expect(COMPACT24_HTML_NAME_MARGIN_BOTTOM_PX).toBe(3);
    expect(COMPACT24_MAX_LINES_PRIMARY_OR_LOCATION).toBe(2);
    expect(COMPACT24_MAX_COLUMNS * COMPACT24_MAX_ROWS).toBe(24);
  });
});
