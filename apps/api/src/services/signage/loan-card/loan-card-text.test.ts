import { describe, expect, it } from 'vitest';
import {
  formatBorrowedCompactLine,
  formatEmployeeCompact,
  splitLocationTwoLines,
  splitPrimaryTwoLines,
  textWidthUnits,
  trimEmployeeNameOneLine,
  trimToUnitsWithEllipsis,
} from './loan-card-text.js';

describe('loan-card-text', () => {
  it('textWidthUnits counts ascii as half', () => {
    expect(textWidthUnits('A')).toBe(0.5);
    expect(textWidthUnits('あ')).toBe(1);
    expect(textWidthUnits('A1あ')).toBe(0.5 + 0.5 + 1);
  });

  it('trimToUnitsWithEllipsis respects max units', () => {
    expect(trimToUnitsWithEllipsis('abcdefghij', 3)).toContain('…');
    expect(trimToUnitsWithEllipsis('あいうえお', 2)).toBe('あ…');
  });

  it('formatBorrowedCompactLine joins date and time with middle dot', () => {
    expect(formatBorrowedCompactLine('04/03 14:30')).toBe('04/03・14:30');
    expect(formatBorrowedCompactLine(null)).toBe('');
  });

  it('formatEmployeeCompact omits honorific', () => {
    expect(formatEmployeeCompact('山田')).toBe('山田');
    expect(formatEmployeeCompact(null)).toBe('未割当');
  });

  it('splitLocationTwoLines splits long location for two lines', () => {
    const r = splitLocationTwoLines('東京都千代田区千代田1-1-1 サンプル工場テスト棟', 10);
    expect(r.line1.length).toBeGreaterThan(0);
    expect(textWidthUnits(r.line1)).toBeLessThanOrEqual(10);
    if (r.line2) {
      expect(textWidthUnits(r.line2)).toBeLessThanOrEqual(10);
    }
  });

  it('splitLocationTwoLines single line when short', () => {
    const r = splitLocationTwoLines('A棟', 10);
    expect(r.line1).toBe('A棟');
    expect(r.line2).toBe('');
  });

  it('splitPrimaryTwoLines wraps long primary', () => {
    const r = splitPrimaryTwoLines('てこ式ダイヤルゲージロング名称サンプル', 8);
    expect(r.line1.length).toBeGreaterThan(0);
    expect(textWidthUnits(r.line1)).toBeLessThanOrEqual(8);
  });

  it('trimEmployeeNameOneLine ellipsizes long names', () => {
    const s = trimEmployeeNameOneLine('非常に長い名前の従業員表示テスト', 10);
    expect(s).toContain('…');
  });
});

