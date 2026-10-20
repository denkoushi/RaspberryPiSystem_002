import { describe, expect, it } from 'vitest';
import { resolveProcedureTextFeedback } from '../procedure-text-feedback.js';

const row = { originalText: 'original', aiText: 'AI', finalText: null, outcome: 'PROPOSED' as const };
const element = { id: 'text', kind: 'TEXT' as const, pageIndex: 0, text: 'AI', zIndex: 0,
  bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.3, heightRatio: 0.1 } };

describe('resolveProcedureTextFeedback', () => {
  it.each([['  AI  ', 'KEPT'], ['human', 'EDITED'], [' original ', 'REVERTED']] as const)('resolves %s as %s', (text, outcome) => {
    expect(resolveProcedureTextFeedback(row, { ...element, text })).toEqual({ outcome, finalText: text });
  });
  it('reverts missing and non-text elements', () => {
    expect(resolveProcedureTextFeedback(row, undefined)).toEqual({ outcome: 'REVERTED', finalText: null });
    expect(resolveProcedureTextFeedback(row, { ...element, kind: 'IMAGE', assetId: 'asset' })).toEqual({ outcome: 'REVERTED', finalText: null });
  });
  it('returns null when unchanged and resolves a later human edit', () => {
    expect(resolveProcedureTextFeedback({ ...row, outcome: 'KEPT', finalText: 'AI' }, element)).toBeNull();
    expect(resolveProcedureTextFeedback({ ...row, outcome: 'REVERTED' }, undefined)).toBeNull();
    expect(resolveProcedureTextFeedback({ ...row, outcome: 'KEPT', finalText: 'AI' }, { ...element, text: 'human' })).toEqual({ outcome: 'EDITED', finalText: 'human' });
  });
});
