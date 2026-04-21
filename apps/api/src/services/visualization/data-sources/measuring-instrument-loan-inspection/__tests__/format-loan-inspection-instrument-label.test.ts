import { describe, expect, it } from 'vitest';
import { formatLoanInspectionInstrumentLabel } from '../format-loan-inspection-instrument-label.js';

describe('formatLoanInspectionInstrumentLabel', () => {
  it('formats name and management number', () => {
    expect(formatLoanInspectionInstrumentLabel('デジタルノギス', 'AG1001')).toBe('デジタルノギス (AG1001)');
    expect(formatLoanInspectionInstrumentLabel('ノギス', 'MI-001')).toBe('ノギス (MI-001)');
  });

  it('trims whitespace', () => {
    expect(formatLoanInspectionInstrumentLabel('  ノギス  ', '  MI-001  ')).toBe('ノギス (MI-001)');
  });

  it('returns name only when management number is empty', () => {
    expect(formatLoanInspectionInstrumentLabel('ノギス', '')).toBe('ノギス');
    expect(formatLoanInspectionInstrumentLabel('ノギス', '   ')).toBe('ノギス');
  });

  it('returns empty string when name is empty', () => {
    expect(formatLoanInspectionInstrumentLabel('', 'MI-001')).toBe('');
    expect(formatLoanInspectionInstrumentLabel('   ', 'MI-001')).toBe('');
  });
});
