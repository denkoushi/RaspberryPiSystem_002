/** 一覧行の要約表示に使うフィールドのみ（API行型への依存を狭める） */
export type KioskDocumentListSummaryFields = {
  confirmedSummaryText: string | null;
  summaryCandidate1: string | null;
  summaryCandidate2: string | null;
  summaryCandidate3: string | null;
};

export function resolveKioskDocumentSummaryText(doc: KioskDocumentListSummaryFields): string {
  return (
    doc.confirmedSummaryText ||
    doc.summaryCandidate1 ||
    doc.summaryCandidate2 ||
    doc.summaryCandidate3 ||
    '本文要約なし'
  );
}
