import { describe, expect, it } from 'vitest';

import { extractFseiban } from '../genpyo-slip/genpyo-fseiban-extract.js';
import { parseActualSlipIdentifiersFromOcrText } from '../genpyo-slip/genpyo-slip-resolver.js';
import { isHaizenEdgeDevice } from '../haizen-edge-device.policy.js';
import { escapeForIlike } from '../part-search/part-search-normalize.js';

describe('extractFseiban', () => {
  it('prefers the labeled 製番 value and upper-cases it', () => {
    expect(extractFseiban('品番 ABCDEFG1 製番: bd1sx009')).toBe('BD1SX009');
  });

  it('accepts a full-width colon, a spaced label and full-width digits after the label', () => {
    // lower-case value: the loose fallback cannot read it, so only the labeled path (with '：') can match
    expect(extractFseiban('製番：bd１sx００9')).toBe('BD1SX009');
    expect(extractFseiban('製番：BD１SX００9')).toBe('BD1SX009');
    expect(extractFseiban('製 番 BD1SX009')).toBe('BD1SX009');
  });

  it('does not read full-width letters (only digits are normalized)', () => {
    // NOTE: possible gap: OCR output with full-width Latin letters yields no fseiban.
    expect(extractFseiban('製　番：ＢＤ１ＳＸ００９')).toBeNull();
  });

  it('requires 6 to 14 alphanumerics after the label', () => {
    expect(extractFseiban('製番 AB12')).toBeNull();
    expect(extractFseiban('製番 ABCDEF')).toBe('ABCDEF');
    expect(extractFseiban('製番 abcdefghij1234')).toBe('ABCDEFGHIJ1234');
  });

  it('truncates a labeled value longer than 14 characters to its first 14', () => {
    // NOTE: possible bug: the labeled regex has no trailing boundary, so an over-long value is
    // silently truncated instead of rejected (genpyo-fseiban-extract.ts labeled match).
    expect(extractFseiban('製番 abcdefghij1234xyz')).toBe('ABCDEFGHIJ1234');
  });

  it('falls back to a standalone upper-case token of 6-12 chars starting with a letter', () => {
    expect(extractFseiban('no label here CA1QAS09 end')).toBe('CA1QAS09');
    expect(extractFseiban('lowercase ca1qas09 only')).toBeNull();
    expect(extractFseiban('12345678 digits only')).toBeNull();
    expect(extractFseiban('TOOLONGTOKEN123 only')).toBeNull();
  });
});

describe('parseActualSlipIdentifiersFromOcrText', () => {
  it('returns null identifiers for text without any', () => {
    expect(parseActualSlipIdentifiersFromOcrText('')).toEqual({ manufacturingOrder10: null, fseiban: null });
  });

  it('extracts the 10-digit order number and the fseiban from one slip', () => {
    expect(parseActualSlipIdentifiersFromOcrText('製造オーダNo 0001234567 製番 BD1SX009')).toEqual({
      manufacturingOrder10: '0001234567',
      fseiban: 'BD1SX009',
    });
    expect(parseActualSlipIdentifiersFromOcrText('0001234567')).toEqual({ manufacturingOrder10: '0001234567', fseiban: null });
  });
});

describe('isHaizenEdgeDevice', () => {
  it('only treats an explicit true flag as a haizen edge device', () => {
    expect(isHaizenEdgeDevice({ haizenEdgeEnabled: true })).toBe(true);
    expect(isHaizenEdgeDevice({ haizenEdgeEnabled: false })).toBe(false);
    expect(isHaizenEdgeDevice({ haizenEdgeEnabled: 'true' as unknown as boolean })).toBe(false);
  });
});

describe('escapeForIlike', () => {
  it('escapes ILIKE wildcards and the escape character itself', () => {
    expect(escapeForIlike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(escapeForIlike('plain')).toBe('plain');
  });
});
