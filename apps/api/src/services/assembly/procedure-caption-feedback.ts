import type { AssemblyProcedureCaptionFeedback } from '@prisma/client';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

type FeedbackState = Pick<AssemblyProcedureCaptionFeedback, 'aiText' | 'outcome' | 'finalText'>;
type FeedbackChange = Pick<AssemblyProcedureCaptionFeedback, 'outcome' | 'finalText'>;

// Null means no change, so the caller leaves resolvedAt untouched.
export function resolveProcedureCaptionFeedback(
  row: FeedbackState,
  element: AssemblyProcedureOverlayElement | undefined,
  applied: boolean
): FeedbackChange | null {
  let next: FeedbackChange;
  if (element) {
    if (element.kind !== 'TEXT') return null;
    next = { finalText: element.text, outcome: element.text.trim() === row.aiText.trim() ? 'KEPT' : 'EDITED' };
  } else if (row.outcome === 'KEPT' || row.outcome === 'EDITED' || applied) {
    next = { finalText: null, outcome: 'DELETED' };
  } else {
    return null;
  }
  return next.outcome === row.outcome && next.finalText === row.finalText ? null : next;
}
