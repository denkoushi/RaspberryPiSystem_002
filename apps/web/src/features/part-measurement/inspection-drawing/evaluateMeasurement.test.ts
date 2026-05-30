import { describe, expect, it } from 'vitest';

import { evaluateMeasurementValue, parseMeasurementNumber } from './evaluateMeasurement';

describe('parseMeasurementNumber', () => {
  it('parses decimal strings', () => {
    expect(parseMeasurementNumber('20.01')).toBe(20.01);
    expect(parseMeasurementNumber('')).toBeNull();
  });
});

describe('evaluateMeasurementValue', () => {
  it('returns ok within bounds', () => {
    expect(evaluateMeasurementValue(20, 19.98, 20.02)).toBe('ok');
    expect(evaluateMeasurementValue(19.97, 19.98, 20.02)).toBe('ng');
    expect(evaluateMeasurementValue(null, 0, 1)).toBe('empty');
  });
});
