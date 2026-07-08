import {
  buildInspectionDrawingToleranceCandidateValues,
  buildInspectionDrawingToleranceCandidateValuesForLabel,
  resolveDefaultInspectionDrawingToleranceKind,
  resolveInspectionDrawingGeneralToleranceForNominal
} from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

describe('inspection drawing tolerance candidates', () => {
  it('builds geometric tolerance candidates for degree labels', () => {
    expect(resolveDefaultInspectionDrawingToleranceKind('直角度')).toBe('geometric');
    expect(buildInspectionDrawingToleranceCandidateValues('geometric')).toEqual([
      '0',
      '0.001',
      '0.002',
      '0.003',
      '0.004',
      '0.005',
      '0.006',
      '0.007',
      '0.008',
      '0.009',
      '0.01',
      '0.015',
      '0.020',
      '0.030',
      '0.050'
    ]);
  });

  it('builds dimension tolerance candidates with signed positive values', () => {
    expect(resolveDefaultInspectionDrawingToleranceKind('幅')).toBe('dimension');
    expect(resolveDefaultInspectionDrawingToleranceKind('厚み')).toBe('dimension');
    expect(buildInspectionDrawingToleranceCandidateValues('dimension')).toEqual([
      '-0.9',
      '-0.8',
      '-0.7',
      '-0.6',
      '-0.5',
      '-0.4',
      '-0.3',
      '-0.2',
      '-0.1',
      '0',
      '+0.1',
      '+0.2',
      '+0.3',
      '+0.4',
      '+0.5',
      '+0.6',
      '+0.7',
      '+0.8',
      '+0.9'
    ]);
  });

  it('classifies 面粗度 as geometric under the initial degree rule', () => {
    expect(resolveDefaultInspectionDrawingToleranceKind('面粗度')).toBe('geometric');
  });

  it('builds depth tolerance candidates for 深さ and ネジ穴深さ labels', () => {
    const depthCandidates = Array.from({ length: 21 }, (_, index) => String(index));

    expect(buildInspectionDrawingToleranceCandidateValuesForLabel('深さ')).toEqual(depthCandidates);
    expect(buildInspectionDrawingToleranceCandidateValuesForLabel('ネジ穴深さ')).toEqual(depthCandidates);
    expect(buildInspectionDrawingToleranceCandidateValuesForLabel(' 深さ ')).toEqual(depthCandidates);
  });

  it('delegates non-depth labels to tolerance kind candidates', () => {
    expect(buildInspectionDrawingToleranceCandidateValuesForLabel('幅')).toEqual(
      buildInspectionDrawingToleranceCandidateValues('dimension')
    );
    expect(buildInspectionDrawingToleranceCandidateValuesForLabel('直角度')).toEqual(
      buildInspectionDrawingToleranceCandidateValues('geometric')
    );
  });

  it('resolves general tolerance for nominal values', () => {
    expect(resolveInspectionDrawingGeneralToleranceForNominal(0.4)).toBeNull();
    expect(resolveInspectionDrawingGeneralToleranceForNominal(0.5)).toBe('0.1');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(6)).toBe('0.1');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(6.1)).toBe('0.2');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(30)).toBe('0.2');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(120)).toBe('0.3');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(400)).toBe('0.5');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(1000)).toBe('0.8');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(2000)).toBe('1.2');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(4000)).toBe('2.0');
    expect(resolveInspectionDrawingGeneralToleranceForNominal(4001)).toBeNull();
    expect(resolveInspectionDrawingGeneralToleranceForNominal(Number.NaN)).toBeNull();
    expect(resolveInspectionDrawingGeneralToleranceForNominal(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
