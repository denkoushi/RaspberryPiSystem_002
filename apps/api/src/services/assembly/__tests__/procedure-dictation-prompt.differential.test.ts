import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildProcedureDictationMessages } from '../procedure-dictation-prompt.js';
import { buildLegacyProcedureDictationMessages } from './legacy/procedure-dictation-prompt.legacy.js';

describe('dictation prompt without learning', () => {
  it('preserves the original messages byte for byte in every mode', () => {
    const text = fc.oneof(fc.string(), fc.constantFrom('', 'えーと、棚に直す。', ' 既存\n文章「１２」\r\n', '"\\{}'));
    fc.assert(fc.property(text, fc.option(text, { nil: undefined }), (spokenText, currentText) => {
      for (const mode of ['new', 'append', 'revise'] as const) {
        const input = { mode, spokenText, currentText };
        expect(buildProcedureDictationMessages(input)).toEqual(buildLegacyProcedureDictationMessages(input));
      }
    }), { numRuns: 1000 });
  });
});
