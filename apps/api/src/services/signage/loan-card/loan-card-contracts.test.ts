import { describe, expect, it } from 'vitest';
import {
  COMPACT24_CARD_HEIGHT_PX,
  COMPACT24_MAX_COLUMNS,
  COMPACT24_MAX_LINES_PRIMARY_OR_LOCATION,
  COMPACT24_MAX_ROWS,
} from './loan-card-contracts.js';

describe('loan-card-contracts', () => {
  it('defines splitCompact24 grid and text contracts', () => {
    expect(COMPACT24_MAX_COLUMNS).toBe(4);
    expect(COMPACT24_MAX_ROWS).toBe(6);
    expect(COMPACT24_CARD_HEIGHT_PX).toBe(154);
    expect(COMPACT24_MAX_LINES_PRIMARY_OR_LOCATION).toBe(2);
    expect(COMPACT24_MAX_COLUMNS * COMPACT24_MAX_ROWS).toBe(24);
  });
});
