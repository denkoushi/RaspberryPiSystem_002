import { describe, expect, it } from 'vitest';

import {
  extractFseiban,
  extractManufacturingOrder10,
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
