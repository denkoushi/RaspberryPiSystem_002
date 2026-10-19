export type SelfInspectionSessionNoticeTone = 'amber' | 'red' | 'cyan' | 'neutral';

export type SelfInspectionSessionNotice = {
  message: string;
  tone: SelfInspectionSessionNoticeTone;
};

type Inputs = {
  actionError?: string | null;
  nfcMessage?: string | null;
  guideHint?: string | null;
  saveReason?: string | null;
  saveReasonIsOutOfTolerance?: boolean;
  completeHint?: string | null;
};

/** Selects the single header notice without mutating or coupling the underlying workflow states. */
export function resolveSelfInspectionSessionNotice({
  actionError,
  nfcMessage,
  guideHint,
  saveReason,
  saveReasonIsOutOfTolerance = false,
  completeHint
}: Inputs): SelfInspectionSessionNotice | null {
  if (actionError) return { message: actionError, tone: 'amber' };
  if (nfcMessage) return { message: nfcMessage, tone: 'amber' };
  if (guideHint) return { message: guideHint, tone: 'cyan' };
  if (saveReason) {
    return { message: saveReason, tone: saveReasonIsOutOfTolerance ? 'red' : 'neutral' };
  }
  if (completeHint) return { message: completeHint, tone: 'cyan' };
  return null;
}
