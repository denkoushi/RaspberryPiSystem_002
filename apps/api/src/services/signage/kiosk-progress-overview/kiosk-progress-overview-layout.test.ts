import { describe, expect, it } from 'vitest';

import {
  KIOSK_PROGRESS_GRID_COLUMNS,
  KIOSK_PROGRESS_GRID_ROWS,
  computeKioskProgressOverviewGridSlots,
} from './kiosk-progress-overview-layout.js';

describe('computeKioskProgressOverviewGridSlots', () => {
  it('returns 8 slots in row-major order for 4x2 at 1920x1080', () => {
    const scale = 1;
    const outerPad = Math.round(12 * scale);
    const colGap = Math.round(8 * scale);
    const rowGap = Math.round(8 * scale);

    const slots = computeKioskProgressOverviewGridSlots({
      width: 1920,
      height: 1080,
      columns: KIOSK_PROGRESS_GRID_COLUMNS,
      rows: KIOSK_PROGRESS_GRID_ROWS,
      outerPad,
      colGap,
      rowGap,
    });

    expect(slots).toHaveLength(8);

    const innerW = 1920 - 2 * outerPad;
    const innerH = 1080 - 2 * outerPad;
    const expectedCardW = (innerW - 3 * colGap) / 4;
    const expectedCardH = (innerH - 1 * rowGap) / 2;

    expect(slots[0]).toMatchObject({
      index: 0,
      col: 0,
      row: 0,
      x0: outerPad,
      y0: outerPad,
      cardW: expectedCardW,
      cardH: expectedCardH,
    });

    expect(slots[3]).toMatchObject({
      index: 3,
      col: 3,
      row: 0,
      x0: outerPad + 3 * (expectedCardW + colGap),
      y0: outerPad,
    });

    expect(slots[4]).toMatchObject({
      index: 4,
      col: 0,
      row: 1,
      x0: outerPad,
      y0: outerPad + expectedCardH + rowGap,
    });

    expect(slots[7]).toMatchObject({
      index: 7,
      col: 3,
      row: 1,
    });

    for (let c = 1; c < 4; c += 1) {
      expect(slots[c].x0).toBeGreaterThan(slots[c - 1].x0);
    }
    expect(slots[4].x0).toBe(slots[0].x0);
    expect(slots[4].y0).toBeGreaterThan(slots[0].y0);
  });

  it('returns empty array for invalid dimensions', () => {
    expect(
      computeKioskProgressOverviewGridSlots({
        width: 100,
        height: 100,
        columns: 0,
        rows: 2,
        outerPad: 10,
        colGap: 8,
        rowGap: 8,
      })
    ).toEqual([]);
  });
});
