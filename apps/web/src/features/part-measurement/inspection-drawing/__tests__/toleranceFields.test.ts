import { describe, expect, it } from 'vitest';

import {
  absoluteBoundsToToleranceRaw,
  dbAbsoluteBoundsToToleranceRawFields,
  parseToleranceRawFields
} from '../toleranceFields';

describe('toleranceFields', () => {
  it('rejects empty nominal', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '',
      lowerToleranceRaw: '0.1',
      upperToleranceRaw: '0.1'
    });
    expect(result).toHaveProperty('error');
  });

  it('rejects negative tolerance width', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '10',
      lowerToleranceRaw: '-0.1',
      upperToleranceRaw: '0.1'
    });
    expect(result).toHaveProperty('error');
  });

  it('computes absolute bounds from positive widths', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '10',
      lowerToleranceRaw: '0.1',
      upperToleranceRaw: '0.2'
    });
    expect(result).toEqual({ nominal: 10, lowerLimit: 9.9, upperLimit: 10.2 });
  });

  it('round-trips absolute bounds to raw fields', () => {
    const raw = absoluteBoundsToToleranceRaw(10, 9.9, 10.1);
    const parsed = parseToleranceRawFields(raw);
    expect(parsed).toEqual({ nominal: 10, lowerLimit: 9.9, upperLimit: 10.1 });
  });

  it('allows negative nominal values', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '-10',
      lowerToleranceRaw: '0.1',
      upperToleranceRaw: '0.2'
    });
    expect(result).toEqual({ nominal: -10, lowerLimit: -10.1, upperLimit: -9.8 });
  });

  it('round-trips negative nominal bounds', () => {
    const raw = absoluteBoundsToToleranceRaw(-5, -5.5, -4.5);
    const parsed = parseToleranceRawFields(raw);
    expect(parsed).toEqual({ nominal: -5, lowerLimit: -5.5, upperLimit: -4.5 });
  });

  it('does not coerce null nominal to zero for legacy absolute-only rows', () => {
    const raw = dbAbsoluteBoundsToToleranceRawFields({
      nominalValue: null,
      lowerLimit: 19.98,
      upperLimit: 20.02
    });
    expect(raw.nominalRaw).toBe('');
    expect(raw.legacyAbsoluteBounds).toEqual({ lowerLimit: 19.98, upperLimit: 20.02 });
  });
});
