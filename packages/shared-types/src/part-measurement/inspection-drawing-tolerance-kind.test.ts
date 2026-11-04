import { describe, expect, it } from 'vitest';

import {
  INSPECTION_DRAWING_THROUGH_SENTINEL_LIMIT,
  isInspectionDrawingDepthLabel,
  isInspectionDrawingThroughDepthMode,
  normalizeInspectionDrawingDepthMode
} from './inspection-drawing-depth-mode.js';
import { extractInspectionDrawingAsciiDigits } from './inspection-drawing-digit-search.js';
import {
  DEFAULT_INSPECTION_DRAWING_MEASUREMENT_LABELS,
  buildDefaultInspectionDrawingMeasurementLabelSettings,
  buildInspectionDrawingToleranceCandidateValuesForLabel,
  mergeInspectionDrawingMeasurementLabelSettings,
  resolveDefaultInspectionDrawingToleranceKind,
  resolveInspectionDrawingToleranceKindForLabel
} from './inspection-drawing-tolerance-kind.js';

describe('resolveDefaultInspectionDrawingToleranceKind', () => {
  it('classifies labels containing 度 as geometric and others as dimension', () => {
    expect(resolveDefaultInspectionDrawingToleranceKind('平行度')).toBe('geometric');
    expect(resolveDefaultInspectionDrawingToleranceKind('  位置度  ')).toBe('geometric');
    expect(resolveDefaultInspectionDrawingToleranceKind('外径')).toBe('dimension');
    // 「振れ」「輪郭」は幾何公差の概念だが 度 を含まないので dimension 扱いになる（現行仕様の固定）
    expect(resolveDefaultInspectionDrawingToleranceKind('振れ')).toBe('dimension');
    expect(resolveDefaultInspectionDrawingToleranceKind('輪郭')).toBe('dimension');
    expect(resolveDefaultInspectionDrawingToleranceKind('')).toBe('dimension');
  });
});

describe('buildDefaultInspectionDrawingMeasurementLabelSettings', () => {
  it('builds one setting per default label in the original order', () => {
    const settings = buildDefaultInspectionDrawingMeasurementLabelSettings();
    expect(settings.map((s) => s.label)).toEqual([...DEFAULT_INSPECTION_DRAWING_MEASUREMENT_LABELS]);
    expect(settings.find((s) => s.label === '真円度')?.toleranceKind).toBe('geometric');
    expect(settings.find((s) => s.label === '全長')?.toleranceKind).toBe('dimension');
  });

  it('trims labels, skips blanks and keeps the first occurrence of duplicates', () => {
    expect(buildDefaultInspectionDrawingMeasurementLabelSettings([' 外径 ', '', '   ', '外径', '平面度', '平面度 '])).toEqual([
      { label: '外径', toleranceKind: 'dimension' },
      { label: '平面度', toleranceKind: 'geometric' }
    ]);
  });
});

describe('mergeInspectionDrawingMeasurementLabelSettings', () => {
  const defaults = [
    { label: '外径', toleranceKind: 'dimension' as const },
    { label: '平行度', toleranceKind: 'geometric' as const }
  ];

  it('applies overrides to default labels while keeping default order', () => {
    expect(
      mergeInspectionDrawingMeasurementLabelSettings(defaults, [{ label: ' 外径 ', toleranceKind: 'geometric' }])
    ).toEqual([
      { label: '外径', toleranceKind: 'geometric' },
      { label: '平行度', toleranceKind: 'geometric' }
    ]);
  });

  it('appends custom labels sorted after defaults and lets the last override win', () => {
    const merged = mergeInspectionDrawingMeasurementLabelSettings(defaults, [
      { label: 'ねじ長', toleranceKind: 'dimension' },
      { label: 'あご幅', toleranceKind: 'dimension' },
      { label: 'あご幅', toleranceKind: 'geometric' },
      { label: '   ', toleranceKind: 'geometric' }
    ]);
    expect(merged).toEqual([
      { label: '外径', toleranceKind: 'dimension' },
      { label: '平行度', toleranceKind: 'geometric' },
      { label: 'あご幅', toleranceKind: 'geometric' },
      { label: 'ねじ長', toleranceKind: 'dimension' }
    ]);
  });

  it('drops blank default labels', () => {
    expect(
      mergeInspectionDrawingMeasurementLabelSettings([{ label: ' ', toleranceKind: 'dimension' }, ...defaults], [])
    ).toEqual(defaults);
  });
});

describe('resolveInspectionDrawingToleranceKindForLabel', () => {
  it('prefers a matching setting (trimmed on both sides) over the 度 rule', () => {
    const settings = [{ label: ' 平行度 ', toleranceKind: 'dimension' as const }];
    expect(resolveInspectionDrawingToleranceKindForLabel('平行度  ', settings)).toBe('dimension');
  });

  it('falls back to the default rule when no setting matches', () => {
    expect(resolveInspectionDrawingToleranceKindForLabel('直角度', [{ label: '外径', toleranceKind: 'geometric' }])).toBe(
      'geometric'
    );
    expect(resolveInspectionDrawingToleranceKindForLabel('外径')).toBe('dimension');
  });
});

describe('buildInspectionDrawingToleranceCandidateValuesForLabel', () => {
  it('uses 0..20 integer candidates for depth labels even when settings say geometric', () => {
    const values = buildInspectionDrawingToleranceCandidateValuesForLabel(' キリ穴深さ ', [
      { label: 'キリ穴深さ', toleranceKind: 'geometric' }
    ]);
    expect(values).toHaveLength(21);
    expect(values[0]).toBe('0');
    expect(values[20]).toBe('20');
  });

  it('honours a setting override for non-depth labels', () => {
    const values = buildInspectionDrawingToleranceCandidateValuesForLabel('外径', [
      { label: '外径', toleranceKind: 'geometric' }
    ]);
    expect(values[0]).toBe('0');
    expect(values).toContain('0.050');
    expect(values).not.toContain('+0.1');
  });
});

describe('inspection drawing depth mode', () => {
  it('detects depth labels after trimming and rejects nullish values', () => {
    expect(isInspectionDrawingDepthLabel(' ネジ穴深さ ')).toBe(true);
    expect(isInspectionDrawingDepthLabel('穴深さ')).toBe(false);
    expect(isInspectionDrawingDepthLabel(null)).toBe(false);
    expect(isInspectionDrawingDepthLabel(undefined)).toBe(false);
  });

  it('normalizes only "through" (case/space-insensitive) to through, everything else to measured', () => {
    expect(normalizeInspectionDrawingDepthMode(' THROUGH ')).toBe('through');
    expect(normalizeInspectionDrawingDepthMode('through')).toBe('through');
    expect(normalizeInspectionDrawingDepthMode('thru')).toBe('measured');
    expect(normalizeInspectionDrawingDepthMode('')).toBe('measured');
    expect(normalizeInspectionDrawingDepthMode(null)).toBe('measured');
    expect(isInspectionDrawingThroughDepthMode('Through')).toBe(true);
    expect(isInspectionDrawingThroughDepthMode('measured')).toBe(false);
    expect(INSPECTION_DRAWING_THROUGH_SENTINEL_LIMIT).toBe(0);
  });
});

describe('extractInspectionDrawingAsciiDigits', () => {
  it('keeps only ASCII digits in order (full-width digits are dropped)', () => {
    expect(extractInspectionDrawingAsciiDigits('MD-0012(A)_3')).toBe('00123');
    expect(extractInspectionDrawingAsciiDigits('１２3')).toBe('3');
    expect(extractInspectionDrawingAsciiDigits(null)).toBe('');
    expect(extractInspectionDrawingAsciiDigits(undefined)).toBe('');
  });
});
