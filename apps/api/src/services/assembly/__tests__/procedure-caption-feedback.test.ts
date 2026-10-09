import { describe, expect, it } from 'vitest';
import type { AssemblyProcedureCaptionFeedbackOutcome } from '@prisma/client';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

import { resolveProcedureCaptionFeedback } from '../procedure-caption-feedback.js';

const text: AssemblyProcedureOverlayElement = { id: 'caption', kind: 'TEXT', pageIndex: 0, text: 'AI line', zIndex: 0,
  bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.3, heightRatio: 0.1 } };
const row = (outcome: AssemblyProcedureCaptionFeedbackOutcome, finalText: string | null = null) => ({ outcome, finalText, aiText: ' AI line ' });

describe('caption feedback outcome', () => {
  it.each(['PROPOSED', 'KEPT', 'EDITED', 'DELETED'] as const)('resolves a present caption from %s by trimmed equality', outcome => {
    expect(resolveProcedureCaptionFeedback(row(outcome), { ...text, text: 'AI line ' }, false)).toEqual({ outcome: 'KEPT', finalText: 'AI line ' });
    expect(resolveProcedureCaptionFeedback(row(outcome), { ...text, text: 'Human line' }, false)).toEqual({ outcome: 'EDITED', finalText: 'Human line' });
  });
  it('leaves an unapplied absent proposal unresolved', () => {
    expect(resolveProcedureCaptionFeedback(row('PROPOSED'), undefined, false)).toBeNull();
  });
  it('deletes an applied absent proposal (including apply then undo)', () => {
    expect(resolveProcedureCaptionFeedback(row('PROPOSED'), undefined, true)).toEqual({ outcome: 'DELETED', finalText: null });
  });
  it.each(['KEPT', 'EDITED'] as const)('deletes a previously saved %s caption without applied ids', outcome => {
    expect(resolveProcedureCaptionFeedback(row(outcome, 'previous'), undefined, false)).toEqual({ outcome: 'DELETED', finalText: null });
  });
  it.each([false, true])('leaves an already deleted absent caption unchanged (applied=%s)', applied => {
    expect(resolveProcedureCaptionFeedback(row('DELETED'), undefined, applied)).toBeNull();
  });
  it.each([['KEPT', 'AI line'], ['EDITED', 'Human line']] as const)('leaves unchanged %s text untouched', (outcome, finalText) => {
    expect(resolveProcedureCaptionFeedback(row(outcome, finalText), { ...text, text: finalText }, true)).toBeNull();
  });
  it('updates finalText even if outcome stays the same', () => {
    expect(resolveProcedureCaptionFeedback(row('EDITED', 'first edit'), { ...text, text: 'second edit' }, false)).toEqual({ outcome: 'EDITED', finalText: 'second edit' });
  });
  it('leaves a reused id of another kind untouched', () => {
    expect(resolveProcedureCaptionFeedback(row('KEPT', 'AI line'), { ...text, kind: 'IMAGE', assetId: 'photo' }, true)).toBeNull();
  });
});
