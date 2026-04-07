import { describe, expect, it } from 'vitest';
import { computeSplitCompact24Layout, idealCardWidthForColumnCount } from './loan-card-layout.js';

describe('loan-card-layout', () => {
  it('idealCardWidthForColumnCount yields enough columns', () => {
    const gap = 14;
    const contentWidth = 930;
    const cols = 4;
    const ideal = idealCardWidthForColumnCount(contentWidth, gap, cols);
    const computedCols = Math.max(1, Math.floor((contentWidth + gap) / (ideal + gap)));
    expect(computedCols).toBeGreaterThanOrEqual(cols);
    expect(Math.min(computedCols, cols)).toBe(cols);
  });

  it('computeSplitCompact24Layout places name above thumbnail and date below thumbnail', () => {
    const scale = 1;
    const L = computeSplitCompact24Layout({
      x: 0,
      y: 0,
      cardWidth: 220,
      cardHeight: 164,
      scale,
      cardPadding: 12,
      thumbnailWidth: 96,
      thumbnailHeight: 96,
      thumbnailGap: 12,
      hasThumbnail: true,
      hasWarning: false,
    });
    expect(L.nameY).toBeLessThan(L.thumbnailY);
    expect(L.primary1Y).toBeGreaterThan(L.thumbnailY);
    expect(L.dateY).toBeGreaterThan(L.thumbnailY + 96);
    expect(L.primary1Y).toBeLessThan(L.primary2Y);
    expect(L.loc1Y).toBeLessThan(L.loc2Y);
    expect(L.loc2Y).toBeLessThan(L.thumbnailY + 96);
    expect(L.maxPrimaryUnitsPerLine).toBeGreaterThan(0);
    expect(L.maxEmployeeUnitsPerLine).toBeGreaterThan(0);
    expect(L.maxPrimaryUnitsPerLine).toBeLessThanOrEqual(7);
    expect(L.dateY).toBe(0 + 164 - 12);
    const thumbBottom = L.thumbnailY + 96;
    const inkReserve = L.dateY - thumbBottom;
    expect(inkReserve).toBeGreaterThanOrEqual(6);
    expect(L.thumbnailY).toBeGreaterThanOrEqual(L.nameY);
  });

  it('computeSplitCompact24Layout aligns warning with date on same baseline', () => {
    const L = computeSplitCompact24Layout({
      x: 0,
      y: 0,
      cardWidth: 220,
      cardHeight: 164,
      scale: 1,
      cardPadding: 12,
      thumbnailWidth: 96,
      thumbnailHeight: 96,
      thumbnailGap: 12,
      hasThumbnail: true,
      hasWarning: true,
    });
    expect(L.warningY).toBe(L.dateY);
    expect(L.warningX).not.toBeNull();
    expect(L.warningX!).toBeGreaterThan(L.dateX);
  });
});
