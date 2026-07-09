import { describe, expect, it } from 'vitest';

import {
  areaStatusShortText,
  areaStatusText,
  formatLotQty,
  progressPercent,
  progressText
} from './assemblySessionPresentation';

describe('assemblySessionPresentation', () => {
  it('computes progress text and percent', () => {
    expect(progressText({ acceptedBoltCount: 0, totalBoltCount: 0 })).toBe('0/0');
    expect(progressPercent({ acceptedBoltCount: 0, totalBoltCount: 0 })).toBe(0);
    expect(progressText({ acceptedBoltCount: 4, totalBoltCount: 12 })).toBe('4/12');
    expect(progressPercent({ acceptedBoltCount: 4, totalBoltCount: 12 })).toBe(33);
    expect(progressPercent({ acceptedBoltCount: 12, totalBoltCount: 12 })).toBe(100);
  });

  it('formats area status for card and table density', () => {
    expect(
      areaStatusText({ currentAreaName: 'エリアB', currentBoltMarkerNo: 4 })
    ).toBe('エリアB ・ 締付位置 #4');
    expect(
      areaStatusText({ currentAreaName: null, currentBoltMarkerNo: null })
    ).toBe('エリア完了 ・ 次工程待ち');
    expect(
      areaStatusShortText({ currentAreaName: 'エリアB', currentBoltMarkerNo: 4 })
    ).toBe('エリアB ・ #4');
    expect(
      areaStatusShortText({ currentAreaName: null, currentBoltMarkerNo: null })
    ).toBe('エリア完了 ・ 次工程');
  });

  it('looks up lot quantity with normalized product number keys', () => {
    expect(formatLotQty(' asm-done-001 ', { 'ASM-DONE-001': 3 })).toBe('3');
    expect(formatLotQty('MISSING', { 'ASM-DONE-001': 3 })).toBe('-');
  });
});
