import {
  buildInspectionDrawingToleranceCandidateValues,
  resolveDefaultInspectionDrawingToleranceKind
} from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

describe('inspection drawing tolerance candidates', () => {
  it('builds geometric tolerance candidates for degree labels', () => {
    expect(resolveDefaultInspectionDrawingToleranceKind('直角度')).toBe('geometric');
    expect(buildInspectionDrawingToleranceCandidateValues('geometric')).toEqual([
      '0.001',
      '0.002',
      '0.003',
      '0.004',
      '0.005',
      '0.006',
      '0.007',
      '0.008',
      '0.009'
    ]);
  });

  it('builds dimension tolerance candidates with signed positive values', () => {
    expect(resolveDefaultInspectionDrawingToleranceKind('幅')).toBe('dimension');
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
});
