import { describe, expect, it } from 'vitest';

import { computeDetailRowHeight, computeSummaryRowHeight } from './self-inspection-machine-board-layout.js';

describe('self-inspection-machine-board layout', () => {
  it('computes row height from section headers and part count', () => {
    const rowH = computeSummaryRowHeight({
      bodyHeight: 900,
      sectionCount: 2,
      partCount: 12,
      sectionHeaderHeight: 24,
      groupGap: 8,
      minRowHeight: 24,
    });

    expect(rowH).toBeGreaterThanOrEqual(24);
    const totalHeight = 2 * (24 + 8) + 12 * rowH;
    expect(totalHeight).toBeLessThanOrEqual(900);
  });

  it('shrinks detail heatstrip row height when many measurement points are shown', () => {
    const rowH = computeDetailRowHeight({
      heatAreaHeight: 720,
      rowCount: 24,
      minRowHeight: 30,
      maxRowHeight: 36,
    });

    expect(rowH).toBeLessThan(36);
    expect(rowH).toBeGreaterThanOrEqual(30);
    expect(24 * rowH).toBeLessThanOrEqual(720);
  });
});
