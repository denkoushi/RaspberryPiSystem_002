import { describe, expect, it } from 'vitest';
import { isEmptyCsvBuffer } from '../csv-empty-content.js';

describe('isEmptyCsvBuffer', () => {
  it.each(['\uFEFF', '\uFEFF\uFEFF', '', '\n', '\r\n\r\n', '\uFEFF \t\n', '\u3000']) (
    'recognizes empty CSV content %j',
    (content) => {
      expect(isEmptyCsvBuffer(Buffer.from(content))).toBe(true);
    }
  );

  it.each(['h1,h2\n', 'h1,h2\nv1,v2\n', ',,,', '""']) (
    'keeps CSV content %j for column matching',
    (content) => {
      expect(isEmptyCsvBuffer(Buffer.from(content))).toBe(false);
    }
  );
});
