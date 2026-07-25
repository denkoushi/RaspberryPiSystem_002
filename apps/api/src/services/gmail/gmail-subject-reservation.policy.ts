import { ApiError } from '../../lib/errors.js';

export const ASSEMBLY_PROCEDURE_GMAIL_SUBJECT = 'DocumentASM';
export const GMAIL_SUBJECT_PATTERN_RESERVED_CODE = 'GMAIL_SUBJECT_PATTERN_RESERVED';

const RESERVED_PATTERN_MESSAGE =
  '「DocumentASM」は組立手順書専用の件名です。このメールに一致するCSV件名パターンは登録できません。';

export function normalizeGmailSubjectPattern(value: string): string {
  const trimmed = value.normalize('NFC').trim();
  const withoutLegacyRegexDelimiters =
    trimmed.length >= 2 && trimmed.startsWith('/') && trimmed.endsWith('/')
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  return withoutLegacyRegexDelimiters.toLocaleLowerCase('en-US');
}

/**
 * CSV側は件名の部分一致で照合するため、候補が予約件名に含まれる場合は競合する。
 * 例: DocumentASM / documentasm / ASM はすべて予約件名へ一致する。
 */
export function canCsvSubjectPatternMatchReservedSubject(pattern: string): boolean {
  const normalizedPattern = normalizeGmailSubjectPattern(pattern);
  if (!normalizedPattern) return false;
  const normalizedReserved = normalizeGmailSubjectPattern(ASSEMBLY_PROCEDURE_GMAIL_SUBJECT);
  return normalizedReserved.includes(normalizedPattern);
}

export function assertCsvGmailSubjectPatternAllowed(pattern: string): void {
  if (!canCsvSubjectPatternMatchReservedSubject(pattern)) return;
  throw new ApiError(
    400,
    RESERVED_PATTERN_MESSAGE,
    {
      pattern,
      reservedSubject: ASSEMBLY_PROCEDURE_GMAIL_SUBJECT,
    },
    GMAIL_SUBJECT_PATTERN_RESERVED_CODE
  );
}
