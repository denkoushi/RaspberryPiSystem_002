import { describe, expect, it } from 'vitest';

import {
  formatInspectionDrawingToleranceDisplay,
  formatSignedToleranceOffsetRaw,
  formatToleranceOffsetRangeRaw
} from '../inspectionDrawingToleranceDisplay';

import type { InspectionDrawingPoint } from '../types';

function pointFixture(overrides: Partial<InspectionDrawingPoint> = {}): InspectionDrawingPoint {
  return {
    id: 'p1',
    markerNo: 1,
    name: '外径',
    xRatio: 0.5,
    yRatio: 0.5,
    nominalRaw: '10',
    lowerToleranceRaw: '-0.05',
    upperToleranceRaw: '0.05',
    testValue: '',
    ...overrides
  };
}

describe('inspectionDrawingToleranceDisplay', () => {
  it('adds plus signs to positive tolerance offsets for display only', () => {
    expect(formatSignedToleranceOffsetRaw('0.05')).toBe('+0.05');
    expect(formatSignedToleranceOffsetRaw('+0.05')).toBe('+0.05');
    expect(formatSignedToleranceOffsetRaw('-0.05')).toBe('-0.05');
    expect(formatSignedToleranceOffsetRaw('0')).toBe('0');
  });

  it('formats tolerance offset ranges with the wave separator', () => {
    expect(formatToleranceOffsetRangeRaw('-0.05', '0.05')).toBe('-0.05〜+0.05');
    expect(formatToleranceOffsetRangeRaw('0.10', '0.20')).toBe('+0.10〜+0.20');
    expect(formatToleranceOffsetRangeRaw('0', '0.05')).toBe('0〜+0.05');
  });

  it('formats normal inspection points as nominal plus signed offsets', () => {
    expect(formatInspectionDrawingToleranceDisplay(pointFixture())).toBe('基準 10 / -0.05〜+0.05');
  });

  it('keeps legacy absolute-only points as pass range display', () => {
    expect(
      formatInspectionDrawingToleranceDisplay(
        pointFixture({
          nominalRaw: '',
          lowerToleranceRaw: '',
          upperToleranceRaw: '',
          legacyAbsoluteBounds: { lowerLimit: 9.95, upperLimit: 10.05 }
        }),
        { includeLegacyReason: true }
      )
    ).toBe('合格範囲 9.95〜10.05（基準値未設定）');
  });

  it('formats through depth mode as 通し', () => {
    expect(
      formatInspectionDrawingToleranceDisplay(
        pointFixture({
          name: 'ネジ穴深さ',
          depthMode: 'through',
          nominalRaw: '',
          lowerToleranceRaw: '',
          upperToleranceRaw: ''
        })
      )
    ).toBe('通し');
  });
});
