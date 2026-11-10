import { describe, expect, it } from 'vitest';

import { buildActualSlipOcrPreviewSafe } from './actual-slip-ocr-preview.js';
import {
  collapseInterDigitWhitespace,
  fixAdjacentOcrDigitConfusion,
  normalizeDigitsFullWidthToHalfWidth,
  prepareOcrTextForManufacturingOrderExtraction
} from './genpyo-field-normalize.js';
import { extractManufacturingOrder10, parseManufacturingOrder10Extraction } from './genpyo-mo-extract.js';
import { snapNativeSlip } from './native-slip.js';

describe('genpyo OCR text normalization', () => {
  it('converts only full-width digits to half-width', () => {
    expect(normalizeDigitsFullWidthToHalfWidth('製番０１２９ＡＢ')).toBe('製番0129ＡＢ');
  });

  it('removes whitespace (incl. newlines and ideographic spaces) only between digits', () => {
    expect(collapseInterDigitWhitespace('12 \n 34　56')).toBe('123456');
    expect(collapseInterDigitWhitespace('No 12 AB 34')).toBe('No 12 AB 34');
  });

  it('fixes O/I/l/| only inside digit runs and leaves labels alone', () => {
    expect(fixAdjacentOcrDigitConfusion('1O0')).toBe('100');
    expect(fixAdjacentOcrDigitConfusion('2l|3')).toBe('2113');
    expect(fixAdjacentOcrDigitConfusion('NO1 ID')).toBe('NO1 ID');
    // trailing O is not followed by a digit-like char, so it is kept
    expect(fixAdjacentOcrDigitConfusion('1O')).toBe('1O');
  });

  it('converges over repeated passes for consecutive confusions', () => {
    expect(fixAdjacentOcrDigitConfusion('1OOO0')).toBe('10000');
    expect(fixAdjacentOcrDigitConfusion('9IlI1')).toBe('91111');
  });

  it('applies full-width → whitespace collapse → confusion fix in that order', () => {
    expect(prepareOcrTextForManufacturingOrderExtraction('製造オーダ １２ ３O４')).toBe('製造オーダ 12304');
    // whitespace is collapsed before O→0, so a space next to a misread O is not removed
    expect(prepareOcrTextForManufacturingOrderExtraction('製造オーダ １２ ３O ４')).toBe('製造オーダ 123O 4');
  });
});

describe('parseManufacturingOrder10Extraction sources', () => {
  it('returns none with zero counts when no 10-digit candidate exists', () => {
    expect(parseManufacturingOrder10Extraction('製番 BE1N9321\n数量 3')).toEqual({
      value: null,
      diagnostics: { candidate10Count: 0, afterOrderBlockFilterCount: 0, source: 'none' }
    });
  });

  it('falls back to line-scan when the digits precede the label on the same line', () => {
    expect(parseManufacturingOrder10Extraction('0004099556 製造オーダ')).toEqual({
      value: '0004099556',
      diagnostics: { candidate10Count: 1, afterOrderBlockFilterCount: 0, source: 'line-scan' }
    });
  });

  it('global-filter prefers a candidate near a "No:" marker over an unlabeled earlier one', () => {
    const result = parseManufacturingOrder10Extraction('A 1111111111 B\nNo: 2222222222');
    expect(result).toEqual({
      value: '2222222222',
      diagnostics: { candidate10Count: 2, afterOrderBlockFilterCount: 2, source: 'global-filter' }
    });
  });

  it('global-filter falls back to the earliest candidate when scores tie', () => {
    expect(extractManufacturingOrder10('X 3333333333 Y 4444444444')).toBe('3333333333');
  });

  it('does not take the 10-digit prefix of a longer digit run', () => {
    expect(extractManufacturingOrder10('伝票 12345678901')).toBeNull();
    expect(extractManufacturingOrder10('製造オーダ 12345678901')).toBeNull();
    expect(extractManufacturingOrder10('製造オーダ\n12345678901')).toBeNull();
    // A run of exactly 10 digits next to non-digit text is still extracted.
    expect(extractManufacturingOrder10('製造オーダ No1234567890枝番')).toBe('1234567890');
    expect(extractManufacturingOrder10('伝票 A1234567890B')).toBe('1234567890');
  });

  it('picks the standalone 10-digit run instead of a longer neighbouring number', () => {
    expect(extractManufacturingOrder10('伝票 12345678901 / 9876543210')).toBe('9876543210');
    // Whitespace between digit runs is collapsed first, so merged runs longer than 10 digits are rejected.
    expect(extractManufacturingOrder10('12345678901 9876543210')).toBeNull();
  });
});

describe('buildActualSlipOcrPreviewSafe', () => {
  it('returns null when both inputs are blank', () => {
    expect(buildActualSlipOcrPreviewSafe('  ', '')).toBeNull();
  });

  it('joins distinct values, collapses identical ones and normalizes whitespace', () => {
    expect(buildActualSlipOcrPreviewSafe(' 0004099556 ', '0004099556')).toBe('0004099556');
    expect(buildActualSlipOcrPreviewSafe('0004099556', 'BE1N\n\n9321')).toBe('0004099556 BE1N 9321');
    expect(buildActualSlipOcrPreviewSafe('', 'BE1N9321')).toBe('BE1N9321');
  });

  it('truncates to 120 characters with an ellipsis', () => {
    const exact = 'a'.repeat(120);
    expect(buildActualSlipOcrPreviewSafe(exact, '')).toBe(exact);
    expect(buildActualSlipOcrPreviewSafe('b'.repeat(121), '')).toBe(`${'b'.repeat(120)}…`);
  });
});

describe('snapNativeSlip', () => {
  it('auto-corrects a single confusable character to the known 製番', () => {
    expect(snapNativeSlip(['be1n932I'], '製造order 0004099556', ['BE1N9321'])).toEqual({
      engine: 'device',
      ocrText: '製造order 0004099556',
      ocrPreviewSafe: '0004099556 be1n932I',
      manufacturingOrder10: '0004099556',
      fseibanRaw: 'be1n932I',
      fseibanMatch: 'corrected',
      fseibanCandidates: ['BE1N9321'],
      fseiban: 'BE1N9321'
    });
  });

  it('normalizes the first token as fseiban when snapping is ambiguous, keeping fseibanRaw as read', () => {
    const result = snapNativeSlip([' be1n9320 '], '', ['BE1N9321', 'BE1N9327']);
    expect(result.fseibanMatch).toBe('ambiguous');
    expect(result.fseibanCandidates).toEqual(['BE1N9321', 'BE1N9327']);
    expect(result.fseiban).toBe('BE1N9320');
    expect(result.fseibanRaw).toBe(' be1n9320 ');
    expect(result.manufacturingOrder10).toBeNull();
    expect(result.ocrPreviewSafe).toBe('be1n9320');
  });

  it('reports an exact match found in a later token while fseibanRaw stays the first token', () => {
    const result = snapNativeSlip(['XXXX', 'BE1N9327'], '', ['BE1N9327']);
    expect(result).toMatchObject({ fseibanRaw: 'XXXX', fseibanMatch: 'exact', fseiban: 'BE1N9327' });
  });

  it('returns empty strings when there are no tokens', () => {
    expect(snapNativeSlip([], '', ['BE1N9321'])).toMatchObject({
      fseibanRaw: '',
      fseibanMatch: 'none',
      fseibanCandidates: [],
      fseiban: '',
      ocrPreviewSafe: null
    });
  });
});
