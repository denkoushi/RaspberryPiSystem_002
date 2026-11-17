import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isMachinePartCode, normalizeComparisonText, normalizeMachineName } from './machineName';

describe('normalizeComparisonText', () => {
  it.each([
    [' ＭＨ ', 'MH'],
    ['sh', 'SH'],
    [null, ''],
    [undefined, ''],
    ['MX', 'MX']
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeComparisonText(value)).toBe(expected);
  });
});

describe('isMachinePartCode', () => {
  it.each([
    ['ＭＨ', true],
    ['sh', true],
    [' mh123 ', true],
    [null, false],
    [undefined, false],
    ['MX', false]
  ] as const)('classifies %s as %s', (value, expected) => {
    expect(isMachinePartCode(value)).toBe(expected);
  });
});

describe('normalizeMachineName', () => {
  it.each([
    ['ＤＡＤ３３５０', 'DAD3350'],
    ['！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～', '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'],
    ['dad3350', 'DAD3350'],
    ['  DAD3350  ', 'DAD3350'],
    ['DAD3350', 'DAD3350'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    ['DAD\u30003350', 'DAD 3350'],
    ['\u3000ＤＡＤ３３５０\u3000', 'DAD3350'],
    ['a'.repeat(36), 'A'.repeat(36)],
    ['a'.repeat(37), `${'A'.repeat(36)}...`]
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeMachineName(value)).toBe(expected);
  });

  it.each([
    ['abc', 5, 'ABC'],
    ['abcde', 5, 'ABCDE'],
    ['abcdef', 5, 'ABCDE...']
  ] as const)('normalizes %s with maxChars=%i to %s', (value, maxChars, expected) => {
    expect(normalizeMachineName(value, { maxChars })).toBe(expected);
  });

  const fullWidthCharacter = fc.oneof(
    fc.integer({ min: 0xff01, max: 0xff5e }).map((code) => String.fromCharCode(code)),
    fc.constant('\u3000')
  );
  const asciiOrFullWidthCharacter = fc.oneof(
    fc.integer({ min: 0x20, max: 0x7e }).map((code) => String.fromCharCode(code)),
    fullWidthCharacter
  );
  // These characters neither trim away nor expand when uppercased.
  const machineCharacter = fc.constantFrom('a', 'Z', '0', '-', 'ａ', 'Ｚ', '０', '－');
  const boundedName = fc.integer({ min: 1, max: 36 }).chain((maxChars) =>
    fc.array(machineCharacter, { maxLength: maxChars }).map((characters) => ({
      value: characters.join(''),
      maxChars
    }))
  );
  const overlongName = fc.integer({ min: 1, max: 36 }).chain((maxChars) =>
    fc.array(machineCharacter, { minLength: maxChars + 1, maxLength: maxChars + 40 }).map((characters) => ({
      value: characters.join(''),
      maxChars
    }))
  );

  it('removes full-width ASCII characters and ideographic spaces', () => {
    fc.assert(fc.property(fc.array(fullWidthCharacter), fc.string(), (characters, text) => {
      const result = normalizeMachineName(`${characters.join('')}${text}`);
      expect(result).not.toMatch(/[\uFF01-\uFF5E\u3000]/);
    }));
  });

  it('keeps names within the limit without truncation', () => {
    fc.assert(fc.property(boundedName, ({ value, maxChars }) => {
      const result = normalizeMachineName(value, { maxChars });
      expect(result.length).toBeLessThanOrEqual(maxChars);
      expect(result.length).toBe(value.length);
      expect(result).not.toMatch(/\.\.\.$/);
    }));
  });

  it('appends an ellipsis beyond the limit', () => {
    fc.assert(fc.property(overlongName, ({ value, maxChars }) => {
      const result = normalizeMachineName(value, { maxChars });
      expect(result.endsWith('...')).toBe(true);
      expect(result.length).toBe(maxChars + 3);
    }));
  });

  it('is idempotent for ASCII and full-width ASCII characters and spaces', () => {
    fc.assert(fc.property(fc.array(asciiOrFullWidthCharacter, { maxLength: 100 }), (characters) => {
      const normalized = normalizeMachineName(characters.join(''));
      expect(normalizeMachineName(normalized)).toBe(normalized);
    }));
  });
});
