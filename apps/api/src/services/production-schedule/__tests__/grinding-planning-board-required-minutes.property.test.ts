import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveRequiredMinutes } from '../grinding-planning-board-required-minutes.js';

const minutes = fc.integer({ min: 0, max: 60000 }).map((n) => n / 100);
const quantity = fc.integer({ min: 1, max: 10000 });
const settings = (perUnitMinutes: number, setupMinutes: number, own = true) => ({
  ownSourceResourceCds: own ? ['021'] : [],
  values: [{ resourceCd: '021', fhincd: 'P1', perUnitMinutes, setupMinutes }]
});
const input = (quantity: number, includeSetup = true) => ({
  originalMinutes: 123.45, originalKnown: true, quantity, includeSetup,
  effectiveResourceCd: '021', fhincd: 'P1'
});

describe('resolveRequiredMinutes properties', () => {
  it('conserves own minutes when setup is included only in the first part', () => {
    fc.assert(fc.property(fc.array(quantity, { minLength: 2, maxLength: 20 }), minutes, minutes,
      (parts, perUnit, setup) => {
        const config = settings(perUnit, setup);
        const total = parts.reduce((sum, q, i) => sum + resolveRequiredMinutes(input(q, i === 0), config).requiredMinutes!, 0);
        const whole = resolveRequiredMinutes(input(parts.reduce((a, b) => a + b, 0)), config).requiredMinutes!;
        expect(Math.abs(total - whole)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(whole)));
      }), { numRuns: 1000 });
  });

  it('increases own minutes by per-unit minutes times the quantity delta', () => {
    fc.assert(fc.property(quantity, quantity, minutes, minutes, fc.boolean(), (q, delta, perUnit, setup, includeSetup) => {
      const config = settings(perUnit, setup);
      const difference = resolveRequiredMinutes(input(q + delta, includeSetup), config).requiredMinutes!
        - resolveRequiredMinutes(input(q, includeSetup), config).requiredMinutes!;
      expect(Math.abs(difference - perUnit * delta)).toBeLessThanOrEqual(1e-9 * Math.max(1, perUnit * (q + delta) + setup));
    }), { numRuns: 1000 });
  });

  it('keeps original minutes independent of quantity and setup when own minutes are disabled', () => {
    fc.assert(fc.property(quantity, quantity, minutes, minutes, minutes, fc.boolean(),
      (q1, q2, perUnit, setup1, setup2, includeSetup) => {
        const first = resolveRequiredMinutes(input(q1), settings(perUnit, setup1, false));
        const second = resolveRequiredMinutes(input(q2, includeSetup), settings(perUnit, setup2, false));
        expect(second.requiredMinutes).toBe(first.requiredMinutes);
        expect(second.requiredMinutesSource).toBe('original');
      }), { numRuns: 1000 });
  });
});
