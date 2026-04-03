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

  it('computeSplitCompact24Layout returns ordered baselines with thumbnail', () => {
    const scale = 1;
    const L = computeSplitCompact24Layout({
      x: 0,
      y: 0,
      cardWidth: 220,
      cardHeight: 154,
      scale,
      cardPadding: 12,
      thumbnailWidth: 96,
      thumbnailHeight: 96,
      thumbnailGap: 12,
      hasThumbnail: true,
      hasWarning: false,
    });
    expect(L.primaryY).toBeLessThan(L.nameY);
    expect(L.nameY).toBeLessThan(L.loc1Y);
    expect(L.loc1Y).toBeLessThan(L.loc2Y);
    expect(L.loc2Y).toBeLessThan(L.dateY);
    expect(L.dateY).toBe(L.thumbnailY + 96 - Math.round(3 * scale));
    expect(L.maxLocationUnitsPerLine).toBeGreaterThan(0);
  });

  it('computeSplitCompact24Layout inserts warning between loc2 and date', () => {
    const L = computeSplitCompact24Layout({
      x: 0,
      y: 0,
      cardWidth: 220,
      cardHeight: 154,
      scale: 1,
      cardPadding: 12,
      thumbnailWidth: 96,
      thumbnailHeight: 96,
      thumbnailGap: 12,
      hasThumbnail: true,
      hasWarning: true,
    });
    expect(L.warningY).not.toBeNull();
    expect(L.warningY!).toBeGreaterThan(L.loc2Y);
    expect(L.warningY!).toBeLessThan(L.dateY);
  });
});
