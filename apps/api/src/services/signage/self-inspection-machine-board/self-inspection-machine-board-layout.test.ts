import { describe, expect, it } from 'vitest';

import {
  computeDetailRowHeight,
  computeSelfInspectionMachineBoardCenteredRectY,
  computeSelfInspectionMachineBoardCenteredY,
  computeSelfInspectionMachineBoardResourceRowsTop,
  computeSummaryRowHeight,
} from './self-inspection-machine-board-layout.js';

describe('self-inspection-machine-board layout', () => {
  it('centers standard 40px resource rows and progress bars', () => {
    const rowTop = computeSelfInspectionMachineBoardResourceRowsTop({
      top: 208,
      height: 120,
      rowHeight: 40,
      rowCount: 3,
    });
    const rowCenter = computeSelfInspectionMachineBoardCenteredY({ top: rowTop, height: 40 });
    const barTop = computeSelfInspectionMachineBoardCenteredRectY({
      top: rowTop,
      height: 40,
      itemHeight: 12,
    });

    expect(rowTop).toBe(208);
    expect(rowCenter).toBe(228);
    expect(barTop).toBe(222);
  });

  it('keeps minimum 36px rows and their bars inside the row bounds', () => {
    const rowTop = computeSelfInspectionMachineBoardResourceRowsTop({
      top: 208,
      height: 36,
      rowHeight: 36,
      rowCount: 1,
    });
    const rowCenter = computeSelfInspectionMachineBoardCenteredY({ top: rowTop, height: 36 });
    const barTop = computeSelfInspectionMachineBoardCenteredRectY({
      top: rowTop,
      height: 36,
      itemHeight: 12,
    });

    expect(rowTop).toBe(208);
    expect(rowCenter).toBe(226);
    expect(barTop).toBe(220);
    expect(barTop + 12).toBeLessThanOrEqual(rowTop + 36);
  });

  it('uses one center for mixed 36px, 16px, and 27px text sizes', () => {
    const textCenters = [36, 16, 27].map(() =>
      computeSelfInspectionMachineBoardCenteredY({ top: 112, height: 48 })
    );

    expect(textCenters).toEqual([136, 136, 136]);
  });

  it('balances a one-resource block against a three-resource block in equalized cards', () => {
    const resourceAreaTop = 208;
    const resourceAreaHeight = 120;
    const leftRowsTop = computeSelfInspectionMachineBoardResourceRowsTop({
      top: resourceAreaTop,
      height: resourceAreaHeight,
      rowHeight: 40,
      rowCount: 1,
    });
    const rightRowsTop = computeSelfInspectionMachineBoardResourceRowsTop({
      top: resourceAreaTop,
      height: resourceAreaHeight,
      rowHeight: 40,
      rowCount: 3,
    });

    expect(leftRowsTop).toBe(248);
    expect(rightRowsTop).toBe(208);
    expect(leftRowsTop - resourceAreaTop).toBe(
      resourceAreaHeight - (leftRowsTop + 40 - resourceAreaTop)
    );
    expect(rightRowsTop).toBe(resourceAreaTop);
  });

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
