import { describe, expect, it } from 'vitest';

import {
  collapseInterDigitWhitespace,
  extractFseiban,
  extractManufacturingOrder10,
  fixAdjacentOcrDigitConfusion,
  parseActualSlipIdentifiersFromOcrText
} from '../actual-slip-identifier-parser.js';

describe('extractManufacturingOrder10', () => {
  it('prefers digits after 製造オーダ label over 注文番号 line', () => {
    const text = `
注文番号 0003507502
製造オーダNo : 0002178005
`;
    expect(extractManufacturingOrder10(text)).toBe('0002178005');
  });

  it('handles full-width digits', () => {
    const text = '製造オーダNo：０００２１７８００５';
    expect(extractManufacturingOrder10(text)).toBe('0002178005');
  });

  it('merges whitespace between digits in the 10-digit sequence (OCR noise)', () => {
    const text = '製造オーダNo : 00021 78005';
    expect(extractManufacturingOrder10(text)).toBe('0002178005');
  });

  it('merges newlines between digits after label', () => {
    const text = '製造オーダNo :\n00021\n78005';
    expect(extractManufacturingOrder10(text)).toBe('0002178005');
  });

  it('fixes O/0 confusion in digit runs', () => {
    const text = '製造オーダ 0002178OO5';
    expect(extractManufacturingOrder10(text)).toBe('0002178005');
  });

  it('does not pick 10 digits from 注文番号 block when 製造オーダ line is absent', () => {
    const text = `
注文番号 00035075021
`;
    expect(extractManufacturingOrder10(text)).toBeNull();
  });
});

describe('collapseInterDigitWhitespace', () => {
  it('removes spaces between digits', () => {
    expect(collapseInterDigitWhitespace('12 34 56')).toBe('123456');
  });
});

describe('fixAdjacentOcrDigitConfusion', () => {
  it('converts O between digit-like runs iteratively', () => {
    expect(fixAdjacentOcrDigitConfusion('0002178OO5')).toBe('0002178005');
  });
});

describe('extractFseiban', () => {
  it('extracts after 製番 label', () => {
    expect(extractFseiban('製番 BE1N9321')).toBe('BE1N9321');
  });
});

describe('parseActualSlipIdentifiersFromOcrText', () => {
  it('returns both when present', () => {
    const r = parseActualSlipIdentifiersFromOcrText(`
製造オーダNo 0002178005
製番 BE1N9321
`);
    expect(r.manufacturingOrder10).toBe('0002178005');
    expect(r.fseiban).toBe('BE1N9321');
  });
});
