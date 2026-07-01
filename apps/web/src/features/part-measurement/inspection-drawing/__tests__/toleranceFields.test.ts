import { describe, expect, it } from 'vitest';

import {
  absoluteBoundsToToleranceRaw,
  dbAbsoluteBoundsToToleranceRawFields,
  inferDecimalPlacesFromToleranceRaw,
  parseToleranceRawFields
} from '../toleranceFields';

describe('toleranceFields', () => {
  it('rejects empty nominal', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '',
      lowerToleranceRaw: '-0.1',
      upperToleranceRaw: '0.1'
    });
    expect(result).toHaveProperty('error');
  });

  it('accepts signed lower offset', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '10',
      lowerToleranceRaw: '-0.1',
      upperToleranceRaw: '0.1'
    });
    expect(result).toEqual({ nominal: 10, lowerLimit: 9.9, upperLimit: 10.1 });
  });

  it('accepts positive lower offset (narrower range above nominal)', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '10',
      lowerToleranceRaw: '0.1',
      upperToleranceRaw: '0.2'
    });
    expect(result).toEqual({ nominal: 10, lowerLimit: 10.1, upperLimit: 10.2 });
  });

  it('rejects inverted bounds', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '10',
      lowerToleranceRaw: '0.5',
      upperToleranceRaw: '-0.6'
    });
    expect(result).toHaveProperty('error');
  });

  it('round-trips absolute bounds to signed offset raw', () => {
    const raw = absoluteBoundsToToleranceRaw(10, 9.9, 10.1);
    expect(raw).toEqual({
      nominalRaw: '10',
      lowerToleranceRaw: '-0.1',
      upperToleranceRaw: '0.1'
    });
    const parsed = parseToleranceRawFields(raw);
    expect(parsed).toEqual({ nominal: 10, lowerLimit: 9.9, upperLimit: 10.1 });
  });

  it('allows negative nominal values', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '-10',
      lowerToleranceRaw: '-0.1',
      upperToleranceRaw: '0.2'
    });
    expect(result).toEqual({ nominal: -10, lowerLimit: -10.1, upperLimit: -9.8 });
  });

  it('example 101 with ±0.05', () => {
    const result = parseToleranceRawFields({
      nominalRaw: '101',
      lowerToleranceRaw: '-0.05',
      upperToleranceRaw: '0.05'
    });
    expect(result).toEqual({ nominal: 101, lowerLimit: 100.95, upperLimit: 101.05 });
  });

  it('treats unsigned and explicitly signed upper tolerance as the same positive offset', () => {
    const unsigned = parseToleranceRawFields({
      nominalRaw: '10',
      lowerToleranceRaw: '-0.05',
      upperToleranceRaw: '0.05'
    });
    const explicit = parseToleranceRawFields({
      nominalRaw: '10',
      lowerToleranceRaw: '-0.05',
      upperToleranceRaw: '+0.05'
    });

    expect(unsigned).toEqual({ nominal: 10, lowerLimit: 9.95, upperLimit: 10.05 });
    expect(explicit).toEqual(unsigned);
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

  it('infers decimal places from offset strings', () => {
    expect(
      inferDecimalPlacesFromToleranceRaw({
        nominalRaw: '101',
        lowerToleranceRaw: '-0.05',
        upperToleranceRaw: '0.05'
      })
    ).toBe(2);
  });
});
