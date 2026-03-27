import type { Prisma } from '@prisma/client';

export type BuildKioskDocumentSearchOrOptions = {
  includeCandidateFields: boolean;
};

/**
 * Prisma `contains` は PostgreSQL では `ILIKE '%' || value || '%'` に相当し、
 * 値に含まれる `%` はワイルドカードとして解釈される。誤った全件一致を防ぐため `%` を除去する。
 * （`_` は1文字ワイルドカードだが、品番等に `_` が含まれるためここでは除去しない）
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/%/g, '');
}

/**
 * 要領書フリーワード検索の OR 条件（Prisma `contains` / ILIKE 部分一致）。
 * 呼び出し側で正規化（例: NFKC）は済ませた文字列を渡す。
 */
export function buildKioskDocumentSearchOrConditions(
  normalizedQuery: string,
  options: BuildKioskDocumentSearchOrOptions
): Prisma.KioskDocumentWhereInput[] {
  const q = normalizedQuery;
  const searchTargets: Prisma.KioskDocumentWhereInput[] = [
    { displayTitle: { contains: q, mode: 'insensitive' } },
    { title: { contains: q, mode: 'insensitive' } },
    { filename: { contains: q, mode: 'insensitive' } },
    { sourceAttachmentName: { contains: q, mode: 'insensitive' } },
    { extractedText: { contains: q, mode: 'insensitive' } },
    { confirmedFhincd: { contains: q, mode: 'insensitive' } },
    { confirmedDrawingNumber: { contains: q, mode: 'insensitive' } },
    { confirmedProcessName: { contains: q, mode: 'insensitive' } },
    { confirmedResourceCd: { contains: q, mode: 'insensitive' } },
    { confirmedDocumentNumber: { contains: q, mode: 'insensitive' } },
    { confirmedSummaryText: { contains: q, mode: 'insensitive' } },
  ];
  if (options.includeCandidateFields) {
    searchTargets.push(
      { candidateFhincd: { contains: q, mode: 'insensitive' } },
      { candidateDrawingNumber: { contains: q, mode: 'insensitive' } },
      { candidateProcessName: { contains: q, mode: 'insensitive' } },
      { candidateResourceCd: { contains: q, mode: 'insensitive' } },
      { candidateDocumentNumber: { contains: q, mode: 'insensitive' } },
      { summaryCandidate1: { contains: q, mode: 'insensitive' } },
      { summaryCandidate2: { contains: q, mode: 'insensitive' } },
      { summaryCandidate3: { contains: q, mode: 'insensitive' } },
    );
  }
  return searchTargets;
}
