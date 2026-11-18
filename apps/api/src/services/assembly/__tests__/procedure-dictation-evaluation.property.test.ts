import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dictationFeedbackSplit, scoreDictation } from '../procedure-dictation-evaluation.js';

describe('dictation evaluation properties', () => {
  it('always scores between zero and one', () => {
    fc.assert(fc.property(
      fc.constantFrom('new' as const, 'append' as const, 'revise' as const),
      fc.string(), fc.string(), fc.string(), fc.option(fc.string(), { nil: null }),
      (mode, spokenText, currentText, expected, output) => {
        const { score } = scoreDictation({ id: 'example', mode, spokenText, currentText, expected }, output);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      },
    ), { numRuns: 1000 });
  });

  it('keeps equivalent spoken and final text pairs in the same partition', () => {
    fc.assert(fc.property(fc.string(), fc.string(), (spoken, final) => {
      expect(dictationFeedbackSplit(`\u3000${spoken} \n`, `\n${final}\u3000`))
        .toBe(dictationFeedbackSplit(spoken.normalize('NFKC').trim(), final.normalize('NFKC').trim()));
    }), { numRuns: 1000 });
  });
});
