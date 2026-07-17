import { describe, expect, it } from 'vitest';
import { TorqueUnitConverter, UnsupportedTorqueUnitError } from '../torque-unit-converter.js';

describe('TorqueUnitConverter', () => {
  it.each(['N-m', 'N·m', 'Ｎ・ｍ', 'Nm'])(`normalizes %s`, (unit) => {
    expect(TorqueUnitConverter.toNewtonMetres('12.5', unit).toString()).toBe('12.5');
  });

  it.each(['kgf-cm', 'kgf·cm', 'ｋｇｆ・ｃｍ'])(`converts %s exactly`, (unit) => {
    expect(TorqueUnitConverter.toNewtonMetres('100', unit).toString()).toBe('9.80665');
  });

  it('rejects an unknown unit instead of guessing', () => {
    expect(() => TorqueUnitConverter.toNewtonMetres('1', 'lbf-ft')).toThrow(UnsupportedTorqueUnitError);
  });
});
