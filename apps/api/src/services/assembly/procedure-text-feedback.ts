import type { AssemblyProcedureTextFeedback } from '@prisma/client';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

type FeedbackState = Pick<AssemblyProcedureTextFeedback, 'originalText' | 'aiText' | 'outcome' | 'finalText'>;
type FeedbackChange = Pick<AssemblyProcedureTextFeedback, 'outcome' | 'finalText'>;

export function resolveProcedureTextFeedback(row: FeedbackState, element: AssemblyProcedureOverlayElement | undefined): FeedbackChange | null {
  const finalText = element?.kind === 'TEXT' ? element.text : null;
  const outcome = finalText === null ? 'REVERTED'
    : finalText.trim() === row.aiText.trim() ? 'KEPT'
    : finalText.trim() === row.originalText.trim() ? 'REVERTED' : 'EDITED';
  return outcome === row.outcome && finalText === row.finalText ? null : { outcome, finalText };
}
